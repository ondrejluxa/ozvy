import { describe, expect, it } from "vitest";
import {
  describeLastVisit,
  formatDate,
  formatDateTime,
  formatMonthLong,
  formatMonthShort,
  formatRelative,
  lastMonthKeys,
  monthEnd,
  monthKey,
  monthStart,
  shiftMonthKey,
  toDateOnly,
} from "@/lib/domain/dates";
import {
  formatCZK,
  formatCZKPrecise,
  formatInt,
  formatPercent,
  fromMinor,
  roundEstimateMinor,
  toMinor,
} from "@/lib/domain/money";
import { formatPhone, normalizeSearch } from "@/lib/domain/phone";

const nbsp = (s: string) => s.replace(/\s/g, " ");

describe("dates (Europe/Prague)", () => {
  it("formats Czech dates and times", () => {
    expect(nbsp(formatDate("2026-09-25T10:00:00Z"))).toBe("25. 9. 2026");
    expect(nbsp(formatDateTime("2026-09-25T12:30:00Z"))).toBe("25. 9. 2026 14:30");
  });

  it("uses the Prague calendar for month keys and boundaries", () => {
    // 22:30 UTC on 31 Oct is already 1 Nov in Prague (CET, +1).
    expect(monthKey("2026-10-31T23:30:00Z")).toBe("2026-11");
    expect(monthStart("2026-11").toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(monthEnd("2026-10").toISOString()).toBe("2026-10-31T22:59:59.999Z");
    expect(toDateOnly("2026-10-31T23:30:00Z")).toBe("2026-11-01");
  });

  it("shifts and lists month keys across years", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(lastMonthKeys("2026-02-10T10:00:00Z", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("names months and relative times in Czech", () => {
    expect(formatMonthShort("2026-10")).toMatch(/^říj/);
    expect(formatMonthLong("2026-10")).toMatch(/2026/);
    const now = new Date("2026-10-05T10:00:00Z");
    expect(formatRelative("2026-10-02T10:00:00Z", now)).toBe("před 3 dny");
    expect(formatRelative("2026-10-05T09:30:00Z", now)).toBe("před 30 minutami");
    expect(formatRelative("2026-10-05T07:00:00Z", now)).toBe("před 3 hodinami");
    expect(formatRelative("2026-06-05T10:00:00Z", now)).toBe("před 4 měsíci");
    expect(formatRelative("2024-10-05T10:00:00Z", now)).toBe("před 2 lety");
  });

  it("describes the last visit naturally", () => {
    const now = new Date("2026-10-05T10:00:00Z");
    expect(describeLastVisit("2026-03-12", now)).toBe("letos v březnu");
    expect(describeLastVisit("2025-09-12", now)).toBe("loni v září");
    expect(describeLastVisit("2024-07-01", now)).toBe("v červenci 2024");
  });
});

describe("money", () => {
  it("converts and formats CZK", () => {
    expect(toMinor(4_990)).toBe(499_000);
    expect(fromMinor(499_000)).toBe(4_990);
    expect(nbsp(formatCZK(52_300_00))).toBe("52 300 Kč");
    expect(nbsp(formatCZKPrecise(90))).toBe("0,90 Kč");
    expect(nbsp(formatInt(1800))).toBe("1 800");
    expect(nbsp(formatPercent(0.06))).toBe("6 %");
  });

  it("rounds estimates to believable figures", () => {
    expect(roundEstimateMinor(43_602_00)).toBe(44_000_00);
    expect(roundEstimateMinor(5_625_00)).toBe(5_600_00);
  });
});

describe("phone and search", () => {
  it("formats Czech numbers and passes others through", () => {
    expect(formatPhone("+420777123456")).toBe("+420 777 123 456");
    expect(formatPhone("+4930123456")).toBe("+4930123456");
    expect(formatPhone(null)).toBe("—");
  });

  it("normalises search terms (diacritics, spaces, dashes)", () => {
    expect(normalizeSearch("Novák 2S4-7710")).toBe("novak2s47710");
  });
});
