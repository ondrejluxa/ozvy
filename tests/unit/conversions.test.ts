import { describe, expect, it } from "vitest";
import {
  allowedActions,
  attributionWindow,
  conversionErrorCode,
  parseJobValue,
  pickEnrollment,
  windowOpen,
  type EnrollmentView,
} from "@/lib/domain/attribution/conversions";
import { monthStart } from "@/lib/jobs/stats-core";

const day = 86_400_000;
const sent = new Date("2026-09-14T08:00:00Z");
const at = (days: number) => new Date(sent.getTime() + days * day);

const treated: EnrollmentView = {
  id: "e1",
  stage: "contacted",
  isHoldout: false,
  firstSentAt: sent.toISOString(),
  campaignStartedAt: sent.toISOString(),
  windowEndsAt: at(60).toISOString(),
};

describe("attribution window (spec §14)", () => {
  it("starts at the first SMS, or at the campaign start for the holdout", () => {
    expect(attributionWindow(treated).start).toEqual(sent);
    const holdout = { ...treated, isHoldout: true, firstSentAt: null, campaignStartedAt: at(-1).toISOString() };
    expect(attributionWindow(holdout).start).toEqual(at(-1));
    expect(windowOpen({ ...treated, firstSentAt: null }, at(1))).toBe(false);
  });

  it("is open from the first SMS until the window end", () => {
    expect(windowOpen(treated, at(-0.1))).toBe(false);
    expect(windowOpen(treated, at(0))).toBe(true);
    expect(windowOpen(treated, at(60))).toBe(true);
    expect(windowOpen(treated, at(60.01))).toBe(false);
  });
});

describe("pipeline buttons", () => {
  it.each([
    ["contacted", 5, ["book", "complete"]],
    ["contacted", 70, []],
    ["booked", 5, ["complete", "revert"]],
    ["booked", 70, ["revert"]],
    ["completed", 70, ["edit", "revert"]],
    ["lost", 5, []],
    ["opted_out", 5, []],
  ] as const)("%s on day %i → %o", (stage, d, expected) => {
    expect(allowedActions({ ...treated, stage }, at(d))).toEqual(expected);
  });
});

describe("last touch (spec §14)", () => {
  it("the most recent first SMS whose window covers the date wins; holdout only as a fallback", () => {
    const newer = { ...treated, id: "e2", firstSentAt: at(20).toISOString(), windowEndsAt: at(80).toISOString() };
    const holdout = { ...treated, id: "h", isHoldout: true, firstSentAt: null };
    expect(pickEnrollment([treated, newer, holdout], at(10))?.id).toBe("e1");
    expect(pickEnrollment([treated, newer, holdout], at(30))?.id).toBe("e2");
    expect(pickEnrollment([treated, newer, holdout], at(70))?.id).toBe("e2");
    expect(pickEnrollment([holdout], at(10))?.id).toBe("h");
    expect(pickEnrollment([treated], at(90))).toBeNull();
  });
});

describe("job value input", () => {
  it.each([
    ["4800", 480_000],
    ["4 800", 480_000],
    ["4 800 Kč", 480_000],
    ["4800,50", 480_050],
    ["1", 100],
    ["500000", 50_000_000],
  ])("%s → %i haléřů", (input, minor) => {
    expect(parseJobValue(input)).toBe(minor);
  });
  it.each(["", "0", "0,5", "-100", "500001", "abc", "1.234,5", "12,345"])("%s is rejected", (input) => {
    expect(parseJobValue(input)).toBeNull();
  });
});

describe("helpers", () => {
  it("maps database errors to user-facing codes", () => {
    expect(conversionErrorCode("conversion_outside_window")).toBe("conversion_outside_window");
    expect(conversionErrorCode("P0001: conversion_newer_campaign")).toBe("conversion_newer_campaign");
    expect(conversionErrorCode("something else")).toBeNull();
    expect(conversionErrorCode(undefined)).toBeNull();
  });

  it("month starts follow the Prague calendar", () => {
    expect(monthStart(new Date("2026-11-05T10:00:00Z"))).toBe("2026-11-01");
    expect(monthStart(new Date("2026-11-05T10:00:00Z"), -1)).toBe("2026-10-01");
    expect(monthStart(new Date("2026-01-10T10:00:00Z"), -1)).toBe("2025-12-01");
    // 23:30 UTC on 31 Oct is already 1 Nov in Prague.
    expect(monthStart(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });
});
