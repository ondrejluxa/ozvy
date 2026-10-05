import { describe, expect, it } from "vitest";
import { evaluateAlerts, healthFromAlerts } from "@/lib/domain/alerts/rules";
import { holdoutComparison, monthlyKpis, type ConversionLite } from "@/lib/domain/attribution/kpis";
import { averageJobValue, estimateCampaign, selectHoldout } from "@/lib/domain/campaigns/estimates";
import { buildAudience, contactRuleReason } from "@/lib/domain/contact-rules/audience";
import { addDays } from "@/lib/domain/dates";
import { customerStatus, statusFromLastVisit } from "@/lib/domain/lifecycle";
import { formatCZK, formatROI } from "@/lib/domain/money";
import { PRESET_BY_KEY } from "@/lib/domain/segments/presets";
import type { UnitFacts } from "@/lib/domain/segments/types";

const NOW = new Date("2026-10-05T10:00:00Z");
const monthsAgo = (m: number) => addDays(NOW, -m * 30.4375);

describe("money formatting", () => {
  it("uses Czech format", () => {
    expect(formatCZK(52_300_00).replace(/\s/g, " ")).toBe("52 300 Kč");
    expect(formatROI(52_300 / 4_990)).toBe("10,5×");
    expect(formatROI(null)).toBe("—");
  });
});

describe("lifecycle", () => {
  const thresholds = { active_max_months: 9, at_risk_max_months: 12 };
  it("maps last visit to status", () => {
    expect(statusFromLastVisit(monthsAgo(3), NOW, thresholds)).toBe("active");
    expect(statusFromLastVisit(monthsAgo(10), NOW, thresholds)).toBe("at_risk");
    expect(statusFromLastVisit(monthsAgo(15), NOW, thresholds)).toBe("inactive");
  });
  it("rolls up to the best vehicle; opt-out and reactivation override", () => {
    expect(customerStatus({ visitStatuses: ["inactive", "at_risk"], suppressed: false, reactivated: false })).toBe(
      "at_risk",
    );
    expect(customerStatus({ visitStatuses: ["active"], suppressed: false, reactivated: true })).toBe("reactivated");
    expect(customerStatus({ visitStatuses: ["active"], suppressed: true, reactivated: true })).toBe("opted_out");
  });
});

function unit(customerId: string, lastMonthsAgo: number, vehicleId: string | null = `v-${customerId}`): UnitFacts {
  const date = monthsAgo(lastMonthsAgo);
  return {
    customerId,
    vehicleId,
    visits: [{ date, category: "regular_service" }],
    lastVisitAt: date,
    customerLtvPercentile: 0.5,
    customerStatus: "inactive",
  };
}

describe("audience", () => {
  const customers = new Map(
    ["a", "b", "c", "d", "e"].map((id) => [
      id,
      {
        id,
        legal_basis: id === "c" ? ("unknown" as const) : ("consent" as const),
        phone_type: id === "d" ? ("fixed" as const) : ("mobile" as const),
        phone_e164: "+420777000000",
      },
    ]),
  );

  it("applies the rule, one vehicle per customer, eligibility and contact rules", () => {
    const audience = buildAudience({
      units: [
        unit("a", 13),
        unit("a", 15, "v-a2"),
        unit("b", 14),
        unit("c", 13),
        unit("d", 13),
        unit("e", 13),
        unit("x", 2),
      ],
      rules: PRESET_BY_KEY.no_visit_12m.rules,
      presetKey: "no_visit_12m",
      now: NOW,
      customers,
      suppressedCustomerIds: new Set(["b"]),
      contactHistory: new Map([["e", [{ sentAt: addDays(NOW, -10), presetKey: "no_visit_6m", vehicleId: "v-e" }]]]),
      settings: { max_lookback_months: 48 },
    });
    expect(audience.matchedCustomers).toBe(5);
    expect(audience.eligible.map((m) => [m.customerId, m.vehicleId])).toEqual([["a", "v-a2"]]);
    expect(audience.excluded).toMatchObject({ opted_out: 1, no_legal_basis: 1, no_mobile: 1, recently_contacted: 1 });
  });

  it("caps threads per year and repeats of the same preset", () => {
    const four = [40, 120, 200, 300].map((d) => ({ sentAt: addDays(NOW, -d), presetKey: "x", vehicleId: "v" }));
    expect(contactRuleReason(four, NOW, "y", "v")).toBe("yearly_cap");
    expect(contactRuleReason([{ sentAt: addDays(NOW, -60), presetKey: "p", vehicleId: "v" }], NOW, "p", "v")).toBe(
      "same_preset_90d",
    );
    expect(
      contactRuleReason([{ sentAt: addDays(NOW, -95), presetKey: "p", vehicleId: "v" }], NOW, "p", "v"),
    ).toBeNull();
  });
});

describe("estimates and holdout", () => {
  it("computes expected revenue from the send count, not the eligible count", () => {
    const e = estimateCampaign({ eligible: 188, holdoutPct: 0.1, conversionRate: 0.06, avgJobValueMinor: 4_300_00 });
    expect(e).toMatchObject({ holdout: 19, sendCount: 169, maxPotentialMinor: 169 * 4_300_00 });
    expect(e.expectedRevenueMinor).toBe(Math.round(169 * 0.06 * 4_300_00));
  });

  it("uses the median only with 20+ visits", () => {
    expect(averageJobValue([1, 2, 3], 999)).toBe(999);
    expect(
      averageJobValue(
        Array.from({ length: 21 }, (_, i) => i + 1),
        999,
      ),
    ).toBe(11);
  });

  it("selects a reproducible holdout of round(n × pct)", () => {
    const ids = Array.from({ length: 247 }, (_, i) => `c${i}`);
    const a = selectHoldout(ids, 0.1, "campaign-1");
    expect(a.size).toBe(25);
    expect([...selectHoldout(ids, 0.1, "campaign-1")]).toEqual([...a]);
    expect([...selectHoldout(ids, 0.1, "campaign-2")]).not.toEqual([...a]);
  });
});

describe("KPIs", () => {
  const conv = (o: Partial<ConversionLite>): ConversionLite => ({
    customer_id: "c1",
    campaign_id: "k",
    stage: "completed",
    is_holdout: false,
    booked_at: "2026-10-02T10:00:00Z",
    completed_at: "2026-10-03T10:00:00Z",
    revenue_minor: 5_000_00,
    ...o,
  });

  it("never counts holdout or uncompleted conversions as recovered revenue", () => {
    const k = monthlyKpis(
      [
        conv({}),
        conv({ customer_id: "c2", is_holdout: true }),
        conv({ customer_id: "c3", stage: "booked", completed_at: null, revenue_minor: null }),
        conv({ customer_id: "c4", completed_at: "2026-09-20T10:00:00Z", booked_at: "2026-09-18T10:00:00Z" }),
      ],
      [
        { status: "delivered", sent_at: "2026-10-01T08:00:00Z" },
        { status: "undelivered", sent_at: "2026-10-01T08:00:00Z" },
        { status: "failed", sent_at: null },
      ],
      "2026-10",
      4_990_00,
    );
    expect(k).toMatchObject({ recoveredRevenueMinor: 5_000_00, reactivatedCustomers: 1, bookings: 2, messagesSent: 2 });
  });

  it("requires 30 holdout customers for a comparison", () => {
    expect(
      holdoutComparison({
        treatedCount: 200,
        treatedCompleted: 12,
        treatedRevenueMinor: 60_000_00,
        holdoutCount: 20,
        holdoutCompleted: 0,
      }).sufficient,
    ).toBe(false);
    const c = holdoutComparison({
      treatedCount: 300,
      treatedCompleted: 18,
      treatedRevenueMinor: 90_000_00,
      holdoutCount: 34,
      holdoutCompleted: 1,
    });
    expect(c.sufficient).toBe(true);
    expect(c.incrementalMinor).toBeGreaterThan(0);
  });
});

describe("alerts", () => {
  const base = {
    companyId: "co",
    companyStatus: "active",
    companyCreatedAt: addDays(NOW, -200),
    campaigns: [],
    lastSendAt: addDays(NOW, -5),
    recentDeliveryRate: 0.98,
    roiPreviousMonths: [5, 4] as [number, number],
    topOpportunity: null,
    now: NOW,
  };

  it("is quiet for a healthy company", () => {
    expect(evaluateAlerts(base)).toEqual([]);
    expect(healthFromAlerts([])).toBe("green");
  });

  it("raises the Attention Required rules", () => {
    const alerts = evaluateAlerts({
      ...base,
      lastSendAt: addDays(NOW, -40),
      recentDeliveryRate: 0.8,
      roiPreviousMonths: [0.5, 0.2],
      topOpportunity: { presetKey: "no_visit_12m", expectedRevenueMinor: 44_000_00, eligible: 188 },
      campaigns: [
        {
          id: "w",
          status: "waiting_for_approval",
          createdAt: addDays(NOW, -3),
          sentAt: null,
          sentCount: 0,
          failedCount: 0,
          completedConversions: 0,
        },
        {
          id: "l",
          status: "completed",
          createdAt: addDays(NOW, -70),
          sentAt: addDays(NOW, -60),
          sentCount: 150,
          failedCount: 2,
          completedConversions: 1,
        },
        {
          id: "f",
          status: "active",
          createdAt: addDays(NOW, -3),
          sentAt: addDays(NOW, -2),
          sentCount: 90,
          failedCount: 10,
          completedConversions: 0,
        },
      ],
    });
    expect(alerts.map((a) => a.type).sort()).toEqual(
      [
        "awaiting_approval",
        "campaign_failed",
        "large_opportunity",
        "low_conversion",
        "no_campaign_running",
        "roi_below_1",
        "sms_failure_rate",
      ].sort(),
    );
    expect(healthFromAlerts(alerts)).toBe("red");
  });
});
