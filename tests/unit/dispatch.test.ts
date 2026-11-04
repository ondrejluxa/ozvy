import { describe, expect, it } from "vitest";
import {
  addressAllowed,
  afterSendFailure,
  attributionWindowEnd,
  checkSnapshot,
  MAX_ATTEMPTS,
  messageIdempotencyKey,
  nextCampaignStatus,
  preSendGate,
  randomOptOutToken,
  recipientDrift,
} from "@/lib/domain/messaging/dispatch";

const monday10 = new Date("2026-11-09T09:00:00Z"); // Mon 10:00 Prague
const sunday10 = new Date("2026-11-08T09:00:00Z");
const nov17 = new Date("2026-11-17T09:00:00Z"); // public holiday, Tuesday

describe("idempotency and tokens", () => {
  it("one key per enrollment and step, stable across runs", () => {
    const a = messageIdempotencyKey("enr-1", "step-0");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(messageIdempotencyKey("enr-1", "step-0")).toBe(a);
    expect(messageIdempotencyKey("enr-1", "step-1")).not.toBe(a);
    expect(messageIdempotencyKey("enr-2", "step-0")).not.toBe(a);
  });

  it("opt-out tokens are 8 unambiguous characters and practically unique", () => {
    const tokens = new Set(Array.from({ length: 2000 }, randomOptOutToken));
    expect(tokens.size).toBe(2000);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z2-9]{8}$/);
    for (const t of tokens) expect(t).not.toMatch(/[0O1lI]/);
  });
});

describe("retries (spec §16)", () => {
  it("backs off 1, 5, 15, 60 minutes, then fails after 5 attempts", () => {
    const delays = [1, 2, 3, 4].map((attempt) => {
      const r = afterSendFailure(attempt, true, monday10);
      expect(r.status).toBe("queued");
      return r.status === "queued" ? (r.nextAttemptAt.getTime() - monday10.getTime()) / 60_000 : 0;
    });
    expect(delays).toEqual([1, 5, 15, 60]);
    expect(afterSendFailure(MAX_ATTEMPTS, true, monday10)).toEqual({ status: "failed" });
  });

  it("permanent errors fail at once", () => {
    expect(afterSendFailure(1, false, monday10)).toEqual({ status: "failed" });
  });
});

describe("pre-send checks (spec §12)", () => {
  it("the kill switch and the sending window only delay the start", () => {
    expect(preSendGate({ now: monday10, globalPaused: true })).toEqual({
      action: "wait",
      reason: "global_kill_switch",
    });
    expect(preSendGate({ now: sunday10, globalPaused: false })).toEqual({ action: "wait", reason: "outside_window" });
    expect(preSendGate({ now: nov17, globalPaused: false })).toEqual({ action: "wait", reason: "outside_window" });
    expect(preSendGate({ now: monday10, globalPaused: false })).toEqual({ action: "go" });
  });

  const ok = {
    company: { status: "active", sendingEnabled: true },
    recipients: 100,
    approvedRecipients: 100,
    renderProblems: 0,
    estimatedSegments: 200,
    creditSegments: null,
  };

  it("passes a healthy snapshot", () => {
    expect(checkSnapshot(ok)).toEqual({ action: "send", pauseReason: null });
  });

  it.each([
    [{ company: { status: "paused", sendingEnabled: true } }, "company_paused"],
    [{ company: { status: "closed", sendingEnabled: true } }, "company_closed"],
    [{ company: { status: "active", sendingEnabled: false } }, "company_sending_disabled"],
    [{ recipients: 0 }, "no_recipients"],
    [{ renderProblems: 1 }, "render_failed"],
    [{ creditSegments: 239 }, "provider_credit"],
  ])("fails %o with %s", (patch, reason) => {
    expect(checkSnapshot({ ...ok, ...patch })).toEqual({ action: "fail", reason });
  });

  it("credit with the 1.2 margin is enough", () => {
    expect(checkSnapshot({ ...ok, creditSegments: 240 }).action).toBe("send");
  });

  it("a drift above 20 % sends the snapshot to review (paused)", () => {
    expect(checkSnapshot({ ...ok, recipients: 120 })).toEqual({ action: "send", pauseReason: null });
    expect(checkSnapshot({ ...ok, recipients: 121 })).toEqual({ action: "send", pauseReason: "recipient_drift" });
    expect(checkSnapshot({ ...ok, recipients: 79 })).toEqual({ action: "send", pauseReason: "recipient_drift" });
    expect(recipientDrift(50, null)).toBe(0);
  });
});

describe("whitelist outside production", () => {
  const whitelist = ["+420777000001"];
  it("the mock and production send anywhere; a real provider elsewhere only to the whitelist", () => {
    expect(addressAllowed("+420777123456", { realProvider: false, production: false, whitelist })).toBe(true);
    expect(addressAllowed("+420777123456", { realProvider: true, production: true, whitelist })).toBe(true);
    expect(addressAllowed("+420777123456", { realProvider: true, production: false, whitelist })).toBe(false);
    expect(addressAllowed("+420777000001", { realProvider: true, production: false, whitelist })).toBe(true);
  });
});

describe("campaign progress", () => {
  const base = {
    initialPending: 0,
    pending: 0,
    lastFirstSentAt: monday10,
    maxDelayDays: 7,
    windowEndsAt: attributionWindowEnd(monday10, 60),
  };

  it("sending becomes active once the initial step is dispatched", () => {
    expect(nextCampaignStatus({ ...base, status: "sending", initialPending: 3, now: monday10 })).toBeNull();
    expect(nextCampaignStatus({ ...base, status: "sending", now: monday10 })).toBe("active");
  });

  it("active completes only after follow-ups and the attribution window", () => {
    const day = 86_400_000;
    const at = (days: number) => new Date(monday10.getTime() + days * day);
    expect(nextCampaignStatus({ ...base, status: "active", now: at(30) })).toBeNull();
    expect(nextCampaignStatus({ ...base, status: "active", now: at(60) })).toBe("completed");
    expect(nextCampaignStatus({ ...base, status: "active", pending: 1, now: at(90) })).toBeNull();
    expect(nextCampaignStatus({ ...base, status: "active", maxDelayDays: 70, now: at(65) })).toBeNull();
    expect(nextCampaignStatus({ ...base, status: "active", lastFirstSentAt: null, now: at(90) })).toBeNull();
  });
});
