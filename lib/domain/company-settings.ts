import { z } from "zod";
import type { CompanySettings } from "../db/types";

/**
 * Per-shop thresholds in companies.settings (spec §19): one validated JSON
 * object with defaults in code, so a missing or older settings object always
 * resolves to a complete, valid one.
 *
 * Writes use `companySettingsSchema` (strict, all rules). Reads use
 * `resolveCompanySettings`, which keeps every valid field and falls back to the
 * default for any field that is missing or invalid.
 */

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  lifecycle: { active_max_months: 9, at_risk_max_months: 12 },
  max_lookback_months: 48,
  attribution_window_days: 60,
  holdout_pct: 0.1,
  expected_conversion_rate: 0.06,
  gross_margin_pct: null,
  message_shop_name: null,
  personalized_greeting: false,
};

const lifecycle = z
  .object({
    active_max_months: z.number().int().min(3).max(24),
    at_risk_max_months: z.number().int().min(4).max(36),
  })
  .refine((l) => l.at_risk_max_months > l.active_max_months, {
    message: "at_risk_must_exceed_active",
    path: ["at_risk_max_months"],
  });

const fields = {
  lifecycle,
  // 4 years by default: older contacts are legally weaker (spec §0.4).
  max_lookback_months: z.number().int().min(6).max(60),
  attribution_window_days: z.number().int().min(30).max(120),
  holdout_pct: z.number().min(0.05).max(0.3),
  expected_conversion_rate: z.number().min(0.01).max(0.3),
  gross_margin_pct: z.number().min(0.05).max(0.95).nullable(),
  message_shop_name: z.string().trim().min(2).max(40).nullable(),
  personalized_greeting: z.boolean(),
};

export const companySettingsSchema = z.object(fields);

export function resolveCompanySettings(raw: unknown): CompanySettings {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_COMPANY_SETTINGS, lifecycle: { ...DEFAULT_COMPANY_SETTINGS.lifecycle } };
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const parsed = fields[key].safeParse(input[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

/** Top-level settings keys whose values differ (for the audit log: names only, never values). */
export function changedSettingKeys(before: CompanySettings, after: CompanySettings): string[] {
  return (Object.keys(fields) as (keyof CompanySettings)[]).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
}
