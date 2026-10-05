import { describe, expect, it } from "vitest";
import { monthKey, shiftMonthKey } from "@/lib/domain/dates";
import { monthlyKpis, recoveredRevenue } from "@/lib/domain/attribution/kpis";
import { buildIndex } from "@/lib/db/company-index";
import { presetAudience } from "@/lib/db/derived";
import { seedDemoDatabase } from "@/lib/db/demo/seed";
import { recommendedPreset } from "@/lib/db/stats";

const NOW_DATES = [
  new Date("2026-10-05T12:00:00Z"),
  new Date("2026-11-27T15:00:00Z"),
  new Date("2027-03-02T08:30:00Z"),
  new Date("2026-12-01T06:30:00Z"),
  new Date("2027-01-31T21:00:00Z"),
  new Date("2026-08-15T10:00:00Z"),
];

describe.each(NOW_DATES)("demo seed at %s", (now) => {
  const db = seedDemoDatabase(now);
  const dvorak = db.companies.find((c) => c.name.startsWith("Autoservis Dvořák"))!;
  const index = buildIndex(db, dvorak);
  const month = monthKey(now);

  it("matches the presentation numbers for Autoservis Dvořák", () => {
    expect(index.customers).toHaveLength(1_800);
    expect(index.vehicles).toHaveLength(2_300);
    const kpis = monthlyKpis(index.conversions, index.messages, month, index.subscriptionPriceMinor);
    expect(kpis.messagesSent).toBe(218);
    expect(kpis.bookings).toBe(14);
    expect(kpis.reactivatedCustomers).toBe(11);
    expect(kpis.recoveredRevenueMinor).toBe(52_300_00);
    expect(kpis.subscriptionMinor).toBe(4_990_00);
    expect(Math.round(kpis.roi! * 10) / 10).toBe(10.5);
    expect(recoveredRevenue(index.conversions, shiftMonthKey(month, -1))).toBe(44_300_00);
    expect(recoveredRevenue(index.conversions)).toBe(214_900_00);
  });

  it("keeps a fresh opportunity for the live demo", () => {
    const a = presetAudience(index, "no_visit_12m", now);
    expect(a.audience.eligible.length).toBeGreaterThan(120);
    expect(a.estimate.expectedRevenueMinor).toBeGreaterThan(30_000_00);
    expect(recommendedPreset(index, now)).toBe("no_visit_12m");
  });
});
