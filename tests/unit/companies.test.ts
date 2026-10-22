import { describe, expect, it } from "vitest";
import {
  changedFields,
  isValidIco,
  isValidSenderName,
  normalizeCzechPhone,
  parseCompanyProfile,
  type CompanyProfileInput,
} from "@/lib/domain/company-profile";
import {
  DEFAULT_COMPANY_SETTINGS,
  changedSettingKeys,
  companySettingsSchema,
  resolveCompanySettings,
} from "@/lib/domain/company-settings";
import { dpaFileIssue, dpaObjectPath, sendingBlockers } from "@/lib/domain/dpa";
import { buildSeedWorld } from "@/supabase/seed/rows";

const VALID: CompanyProfileInput = {
  name: "  Autoservis Test  ",
  ico: "284 51 325",
  dic: "cz28451325",
  address_line: "Havlíčkova 1187",
  city: "Kolín",
  postal_code: "28002",
  contact_person: "Pavel Dvořák",
  phone: "321 724 118",
  email: "servis@example.cz",
  website: "servis.example.cz",
  average_job_value_czk: "4 200",
  default_sender_name: "AutoTest",
  opening_hours: "Po–Pá 7:30–17:00",
  requires_client_approval: false,
  status: "onboarding",
};

describe("company profile", () => {
  it("normalises a valid profile into column values", () => {
    const r = parseCompanyProfile(VALID);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.values).toMatchObject({
      name: "Autoservis Test",
      ico: "28451325",
      dic: "CZ28451325",
      postal_code: "280 02",
      phone: "+420321724118",
      average_job_value_minor: 420_000,
      default_sender_name: "AutoTest",
      opening_hours: { note: "Po–Pá 7:30–17:00" },
    });
  });

  it("turns empty optional fields into nulls", () => {
    const r = parseCompanyProfile({
      ...VALID,
      ico: "",
      dic: " ",
      phone: "",
      email: "",
      website: "",
      default_sender_name: "",
      opening_hours: "",
    });
    expect(r.success && r.values).toMatchObject({
      ico: null,
      dic: null,
      phone: null,
      email: null,
      website: null,
      default_sender_name: null,
      opening_hours: {},
    });
  });

  it("reports one error code per invalid field", () => {
    const r = parseCompanyProfile({
      ...VALID,
      name: " ",
      ico: "28451327",
      dic: "SK123",
      postal_code: "2800",
      phone: "12345",
      email: "nope",
      website: "not a site",
      average_job_value_czk: "12.5",
      default_sender_name: "123456",
      status: "deleted",
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.fieldErrors).toEqual({
      name: "required",
      ico: "invalid_ico",
      dic: "invalid_dic",
      postal_code: "invalid_postal_code",
      phone: "invalid_phone",
      email: "invalid_email",
      website: "invalid_website",
      average_job_value_czk: "invalid_job_value",
      default_sender_name: "invalid_sender",
      status: "invalid_status",
    });
  });

  it("validates IČO check digits (and the seeded shops have valid ones)", () => {
    expect(isValidIco("28451325")).toBe(true);
    expect(isValidIco("25596641")).toBe(true); // remainder 1 → check digit 0 rule
    expect(isValidIco("28451327")).toBe(false);
    expect(isValidIco("2845132")).toBe(false);
    for (const c of buildSeedWorld(new Date("2026-10-22T10:00:00Z")).companies) expect(isValidIco(c.ico!)).toBe(true);
  });

  it("normalises Czech phones and SMS sender IDs", () => {
    expect(normalizeCzechPhone("+420 777 123 456")).toBe("+420777123456");
    expect(normalizeCzechPhone("00420777123456")).toBe("+420777123456");
    expect(normalizeCzechPhone("(321) 724-118")).toBe("+420321724118");
    expect(normalizeCzechPhone("+421905123456")).toBeNull();
    expect(normalizeCzechPhone("123456789")).toBeNull();
    expect(isValidSenderName("AutoDvorak")).toBe(true);
    expect(isValidSenderName("Ab")).toBe(false);
    expect(isValidSenderName("Autoservis12")).toBe(false);
    expect(isValidSenderName("Dvořák")).toBe(false);
    expect(isValidSenderName("Auto Test")).toBe(false);
  });

  it("lists changed fields by name only", () => {
    expect(changedFields({ a: 1, b: { x: 1 }, c: "z" }, { a: 1, b: { x: 2 }, c: "y" })).toEqual(["b", "c"]);
  });
});

describe("company settings", () => {
  it("resolves missing or broken settings to the spec defaults", () => {
    expect(resolveCompanySettings(undefined)).toEqual(DEFAULT_COMPANY_SETTINGS);
    expect(resolveCompanySettings([])).toEqual(DEFAULT_COMPANY_SETTINGS);
    expect(DEFAULT_COMPANY_SETTINGS).toMatchObject({
      lifecycle: { active_max_months: 9, at_risk_max_months: 12 },
      max_lookback_months: 48,
      attribution_window_days: 60,
      holdout_pct: 0.1,
      expected_conversion_rate: 0.06,
    });
  });

  it("keeps valid fields and replaces only the invalid ones", () => {
    const s = resolveCompanySettings({
      max_lookback_months: 36,
      attribution_window_days: 500,
      holdout_pct: "0.2",
      lifecycle: { active_max_months: 6, at_risk_max_months: 10 },
      unknown_key: true,
    });
    expect(s.max_lookback_months).toBe(36);
    expect(s.attribution_window_days).toBe(60);
    expect(s.holdout_pct).toBe(0.1);
    expect(s.lifecycle).toEqual({ active_max_months: 6, at_risk_max_months: 10 });
    expect("unknown_key" in s).toBe(false);
  });

  it("enforces the ranges on write", () => {
    const ok = companySettingsSchema.safeParse(DEFAULT_COMPANY_SETTINGS);
    expect(ok.success).toBe(true);
    const bad = companySettingsSchema.safeParse({
      ...DEFAULT_COMPANY_SETTINGS,
      lifecycle: { active_max_months: 12, at_risk_max_months: 9 },
      attribution_window_days: 20,
      holdout_pct: 0.5,
    });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["lifecycle.at_risk_max_months", "attribution_window_days", "holdout_pct"]),
    );
  });

  it("reports changed setting keys", () => {
    const next = {
      ...DEFAULT_COMPANY_SETTINGS,
      holdout_pct: 0.15,
      lifecycle: { active_max_months: 8, at_risk_max_months: 12 },
    };
    expect(changedSettingKeys(DEFAULT_COMPANY_SETTINGS, next)).toEqual(["lifecycle", "holdout_pct"]);
  });

  it("the seeded companies' settings are valid", () => {
    for (const c of buildSeedWorld(new Date("2026-10-22T10:00:00Z")).companies) {
      expect(companySettingsSchema.safeParse(c.settings).success).toBe(true);
    }
  });
});

describe("DPA and sending gate", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n");
  it("accepts a real PDF and rejects the rest", () => {
    expect(dpaFileIssue({ size: 2_000, type: "application/pdf", head: pdf })).toBeNull();
    expect(dpaFileIssue({ size: 2_000, type: "", head: pdf })).toBeNull();
    expect(dpaFileIssue(null)).toBe("missing");
    expect(dpaFileIssue({ size: 0, type: "application/pdf", head: pdf })).toBe("missing");
    expect(dpaFileIssue({ size: 11 * 1024 * 1024, type: "application/pdf", head: pdf })).toBe("too_large");
    expect(dpaFileIssue({ size: 10, type: "application/pdf", head: new TextEncoder().encode("PK\u0003\u0004") })).toBe(
      "not_pdf",
    );
    expect(dpaFileIssue({ size: 10, type: "image/png", head: pdf })).toBe("not_pdf");
  });

  it("stores the DPA under the company folder", () => {
    expect(dpaObjectPath("c0ffee00-0000-4000-8000-000000000000", "u1")).toBe(
      "c0ffee00-0000-4000-8000-000000000000/dpa/u1.pdf",
    );
  });

  it("blocks sending until the DPA is confirmed and while the cooperation ends", () => {
    expect(sendingBlockers({ dpaSignedAt: null, status: "onboarding" })).toEqual(["dpa_missing"]);
    expect(sendingBlockers({ dpaSignedAt: "2026-10-01T10:00:00Z", status: "active" })).toEqual([]);
    expect(sendingBlockers({ dpaSignedAt: "2026-10-01T10:00:00Z", status: "closed" })).toEqual(["company_inactive"]);
  });
});
