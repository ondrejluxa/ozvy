import { describe, expect, it } from "vitest";
import { supportViewBlocks } from "@/lib/auth/access";
import { fetchAllPages } from "@/lib/db/paginate";
import {
  BREAKER,
  breakerState,
  isGatewayFailure,
  pausedUntil,
  shouldTrip,
} from "@/lib/domain/messaging/circuit-breaker";
import { stripEventPayload } from "@/lib/domain/messaging/opt-out";

const NOW = new Date("2026-11-09T09:00:00Z");

describe("SMS gateway circuit breaker (spec §24)", () => {
  it("trips above 20 % gateway failures, with enough attempts to judge", () => {
    expect(shouldTrip({ attempts: 20, failures: 4 })).toBe(false); // exactly 20 %
    expect(shouldTrip({ attempts: 20, failures: 5 })).toBe(true);
    expect(shouldTrip({ attempts: 19, failures: 19 })).toBe(false); // too few attempts
    expect(shouldTrip({ attempts: 0, failures: 0 })).toBe(false);
    expect(BREAKER).toMatchObject({ windowMinutes: 5, maxFailureRate: 0.2, pauseMinutes: 15 });
  });

  it("is open during the pause and probes after it", () => {
    const until = pausedUntil(NOW);
    expect(until.getTime() - NOW.getTime()).toBe(15 * 60_000);
    expect(breakerState(null, NOW)).toBe("closed");
    expect(breakerState(until, new Date(NOW.getTime() + 60_000))).toBe("open");
    expect(breakerState(until, until)).toBe("probe");
  });

  it("counts gateway trouble, not rejected numbers", () => {
    expect(isGatewayFailure({ exception: true })).toBe(true); // timeout / network
    expect(isGatewayFailure({ ok: false, retryable: true })).toBe(true); // 5xx, 429
    expect(isGatewayFailure({ ok: false, retryable: false })).toBe(false); // invalid number
    expect(isGatewayFailure({ ok: true })).toBe(false);
  });
});

describe("reading past the API row limit", () => {
  const source = Array.from({ length: 2345 }, (_, i) => ({ id: i }));
  const fake = (from: number, to: number) =>
    Promise.resolve({ data: source.slice(from, Math.min(to + 1, from + 1000)), error: null });

  it("returns every row, not the first 1,000", async () => {
    const rows = await fetchAllPages(fake);
    expect(rows.length).toBe(2345);
    expect(rows[2344]).toEqual({ id: 2344 });
  });

  it("stops after a short page and on exact multiples", async () => {
    const exact = Array.from({ length: 2000 }, (_, i) => i);
    let calls = 0;
    const rows = await fetchAllPages((from, to) => {
      calls++;
      return Promise.resolve({ data: exact.slice(from, to + 1), error: null });
    });
    expect(rows.length).toBe(2000);
    expect(calls).toBe(3);
  });

  it("fails loudly on an error or a runaway result", async () => {
    await expect(
      fetchAllPages(() => Promise.resolve({ data: null, error: { code: "57014" } }), { label: "audience" }),
    ).rejects.toThrow("audience failed: 57014");
    await expect(fetchAllPages(fake, { maxRows: 2000 })).rejects.toThrow("more than 2000 rows");
  });
});

describe("support view is read-only at the server", () => {
  const admin = { isPlatformAdmin: true };
  it("refuses operator writes while the support view is open", () => {
    expect(supportViewBlocks(admin, true, {})).toBe(true);
    expect(supportViewBlocks(admin, true, { read: true })).toBe(false);
    expect(supportViewBlocks(admin, true, { allowInSupportView: true })).toBe(false);
    expect(supportViewBlocks(admin, false, {})).toBe(false);
    expect(supportViewBlocks({ isPlatformAdmin: false }, true, {})).toBe(false);
    expect(supportViewBlocks(null, true, {})).toBe(false);
  });
});

describe("gateway events keep no personal data after processing", () => {
  it("drops the sender's number and the reply text", () => {
    expect(
      stripEventPayload({
        status: "10",
        from: "420777123456",
        message: "Ne, děkuji",
        _from: "+420777123456",
        _text: "Ne, děkuji",
        date: "2611091005",
        smsID: "tmp1",
      }),
    ).toEqual({ status: "10", date: "2611091005", smsID: "tmp1" });
    expect(stripEventPayload({ type: "delivered", _messageId: "mock_1", messageId: "mock_1" })).toEqual({
      type: "delivered",
      _messageId: "mock_1",
    });
  });
});
