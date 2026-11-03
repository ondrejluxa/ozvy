import { describe, expect, it } from "vitest";
import { averageJobValue, estimateCampaign, selectHoldout } from "@/lib/domain/campaigns/estimates";
import {
  CampaignTransitionError,
  TRANSITIONS,
  canDecideApproval,
  canTransition,
  nextStatus,
  statusGroup,
} from "@/lib/domain/campaigns/status";
import { DEFAULT_FOLLOWUPS, campaignContentIssues } from "@/lib/domain/campaigns/steps";

const TEMPLATE = "{{osloveni}} je čas na servis vašeho vozu v {{servis}}. Volejte {{telefon}}. {{odhlaseni}}";
// Wednesday 18. 11. 2026, 10:00 Prague is inside the window; Sunday is not.
const now = new Date("2026-11-10T09:00:00Z");
const wednesday10 = new Date("2026-11-18T09:00:00Z");
const sunday10 = new Date("2026-11-22T09:00:00Z");

describe("campaign status machine (spec §12)", () => {
  it("follows the diagram", () => {
    expect(nextStatus("draft", "submit", { requiresClientApproval: true })).toBe("waiting_for_approval");
    expect(nextStatus("draft", "submit", { requiresClientApproval: false })).toBe("scheduled");
    expect(nextStatus("waiting_for_approval", "approve")).toBe("scheduled");
    expect(nextStatus("waiting_for_approval", "reject")).toBe("draft");
    expect(nextStatus("scheduled", "cancel")).toBe("cancelled");
    expect(nextStatus("scheduled", "start_sending")).toBe("sending");
    expect(nextStatus("sending", "dispatched")).toBe("active");
    expect(nextStatus("sending", "fail")).toBe("failed");
    expect(nextStatus("failed", "fix")).toBe("draft");
    expect(nextStatus("active", "complete")).toBe("completed");
    expect(nextStatus("paused", "resume")).toBe("active");
  });

  it("refuses everything else", () => {
    expect(() => nextStatus("draft", "approve")).toThrow(CampaignTransitionError);
    expect(() => nextStatus("scheduled", "approve")).toThrow("campaign_approve_not_allowed_from_scheduled");
    expect(() => nextStatus("completed", "cancel")).toThrow(CampaignTransitionError);
    expect(() => nextStatus("draft", "cancel")).toThrow(CampaignTransitionError);
    expect(canTransition("cancelled", "draft")).toBe(false);
    expect(TRANSITIONS).toHaveLength(14);
  });

  it("lets only the shop owner decide in client-approval shops", () => {
    expect(canDecideApproval({ isPlatformAdmin: false, role: "shop_owner", requiresClientApproval: true })).toBe(true);
    expect(canDecideApproval({ isPlatformAdmin: false, role: "shop_manager", requiresClientApproval: true })).toBe(
      false,
    );
    expect(canDecideApproval({ isPlatformAdmin: true, role: null, requiresClientApproval: true })).toBe(false);
    expect(canDecideApproval({ isPlatformAdmin: false, role: "shop_owner", requiresClientApproval: false })).toBe(
      false,
    );
  });

  it("groups statuses like the Kampaně tabs", () => {
    expect(statusGroup("active")).toBe("active");
    expect(statusGroup("waiting_for_approval")).toBe("prepared");
    expect(statusGroup("cancelled")).toBe("finished");
  });
});

describe("campaign content rules", () => {
  const steps = (...delays: number[]) =>
    delays.map((d, i) => ({
      delayDays: d,
      template: i === 0 ? TEMPLATE : (DEFAULT_FOLLOWUPS[i - 1] ?? TEMPLATE),
      stripDiacritics: false,
    }));

  it("accepts an initial message with two follow-ups in the window", () => {
    expect(campaignContentIssues({ steps: steps(0, 3, 7), scheduledAt: wednesday10, now })).toEqual([]);
  });

  it("allows at most two follow-ups, at least two days apart", () => {
    expect(campaignContentIssues({ steps: steps(0, 3, 7, 10), scheduledAt: null, now })).toContainEqual({
      code: "too_many_followups",
    });
    expect(campaignContentIssues({ steps: steps(0, 1), scheduledAt: null, now })).toContainEqual({
      code: "followup_too_soon",
      step: 1,
    });
    expect(campaignContentIssues({ steps: steps(0, 3, 4), scheduledAt: null, now })).toContainEqual({
      code: "followup_too_soon",
      step: 2,
    });
  });

  it("requires the opt-out and shop placeholders in every step", () => {
    const broken = [{ delayDays: 0, template: "{{osloveni}} přijeďte k nám.", stripDiacritics: false }];
    expect(campaignContentIssues({ steps: broken, scheduledAt: null, now })).toEqual([
      { code: "template_invalid", step: 0, issues: ["missing_required", "missing_required"] },
    ]);
    for (const f of DEFAULT_FOLLOWUPS) expect(f).toContain("{{odhlaseni}}");
  });

  it("only schedules in the future and inside the sending window", () => {
    expect(campaignContentIssues({ steps: steps(0), scheduledAt: sunday10, now })).toEqual([
      { code: "send_time_outside_window" },
    ]);
    expect(campaignContentIssues({ steps: steps(0), scheduledAt: new Date("2026-11-09T09:00:00Z"), now })).toEqual([
      { code: "send_time_past" },
    ]);
  });
});

describe("estimates and holdout", () => {
  it("expected revenue uses the conservative rate; holdout is excluded", () => {
    expect(
      estimateCampaign({ eligible: 200, holdoutPct: 0.1, conversionRate: 0.06, avgJobValueMinor: 400_000 }),
    ).toEqual({
      eligible: 200,
      holdout: 20,
      sendCount: 180,
      expectedRevenueMinor: 4_320_000,
      maxPotentialMinor: 72_000_000,
    });
  });

  it("median job value needs 20 visits, else the company average", () => {
    expect(averageJobValue([100, 200, 300], 350_000)).toBe(350_000);
    expect(
      averageJobValue(
        Array.from({ length: 20 }, (_, i) => (i + 1) * 100),
        0,
      ),
    ).toBe(1_050);
  });

  it("selects a reproducible holdout of round(n × pct), seeded by the campaign", () => {
    const ids = Array.from({ length: 95 }, (_, i) => `c${i}`);
    const a = selectHoldout(ids, 0.1, "campaign-1");
    expect(a.size).toBe(10);
    expect(selectHoldout(ids, 0.1, "campaign-1")).toEqual(a);
    expect(selectHoldout(ids, 0.1, "campaign-2")).not.toEqual(a);
  });
});
