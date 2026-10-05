import type { CompanySettings, Customer } from "../../db/types";
import { daysBetween, monthsBetween } from "../dates";
import { evaluateRule } from "../segments/evaluate";
import type { RuleGroup, UnitFacts } from "../segments/types";

/**
 * Builds a campaign audience: rule matches → one vehicle per customer (the
 * most overdue) → marketing eligibility → anti-spam contact rules (spec §12).
 * Eligibility and contact rules are always applied and cannot be turned off.
 */

export type ExclusionReason =
  "opted_out" | "no_legal_basis" | "no_mobile" | "too_old" | "recently_contacted" | "yearly_cap" | "same_preset_90d";

export const EXCLUSION_REASONS: ExclusionReason[] = [
  "opted_out",
  "no_legal_basis",
  "no_mobile",
  "too_old",
  "recently_contacted",
  "yearly_cap",
  "same_preset_90d",
];

/** One sent message thread (initial + follow-ups) for a customer. */
export interface ContactEvent {
  sentAt: Date;
  presetKey: string | null;
  vehicleId: string | null;
}

export interface AudienceMember {
  customerId: string;
  vehicleId: string | null;
  lastVisitAt: Date | null;
}

export interface Audience {
  matchedCustomers: number;
  eligible: AudienceMember[];
  excluded: Record<ExclusionReason, number>;
}

type CustomerLite = Pick<Customer, "id" | "legal_basis" | "phone_type" | "phone_e164">;

export function eligibilityReason(
  customer: CustomerLite,
  suppressed: boolean,
  lastVisitAt: Date | null,
  now: Date,
  settings: Pick<CompanySettings, "max_lookback_months">,
): ExclusionReason | null {
  if (suppressed) return "opted_out";
  if (customer.legal_basis === "unknown") return "no_legal_basis";
  if (!customer.phone_e164 || customer.phone_type !== "mobile") return "no_mobile";
  if (!lastVisitAt || monthsBetween(lastVisitAt, now) > settings.max_lookback_months) return "too_old";
  return null;
}

export function contactRuleReason(
  history: ContactEvent[],
  now: Date,
  presetKey: string | null,
  vehicleId: string | null,
): ExclusionReason | null {
  const past = history.filter((h) => h.sentAt.getTime() <= now.getTime());
  if (past.some((h) => daysBetween(h.sentAt, now) < 30)) return "recently_contacted";
  if (past.filter((h) => daysBetween(h.sentAt, now) < 365).length >= 4) return "yearly_cap";
  if (
    presetKey &&
    past.some((h) => h.presetKey === presetKey && h.vehicleId === vehicleId && daysBetween(h.sentAt, now) < 90)
  ) {
    return "same_preset_90d";
  }
  return null;
}

export function buildAudience(input: {
  units: UnitFacts[];
  rules: RuleGroup;
  presetKey: string | null;
  now: Date;
  customers: Map<string, CustomerLite>;
  suppressedCustomerIds: Set<string>;
  contactHistory: Map<string, ContactEvent[]>;
  settings: Pick<CompanySettings, "max_lookback_months">;
}): Audience {
  const excluded = Object.fromEntries(EXCLUSION_REASONS.map((r) => [r, 0])) as Record<ExclusionReason, number>;

  // One vehicle per customer: keep the most overdue matching unit.
  const byCustomer = new Map<string, UnitFacts>();
  for (const unit of input.units) {
    if (!evaluateRule(input.rules, unit, input.now)) continue;
    const current = byCustomer.get(unit.customerId);
    const unitTime = unit.lastVisitAt?.getTime() ?? 0;
    if (!current || unitTime < (current.lastVisitAt?.getTime() ?? 0)) byCustomer.set(unit.customerId, unit);
  }

  const eligible: AudienceMember[] = [];
  for (const unit of byCustomer.values()) {
    const customer = input.customers.get(unit.customerId);
    if (!customer) continue;
    const reason =
      eligibilityReason(
        customer,
        input.suppressedCustomerIds.has(customer.id),
        unit.lastVisitAt,
        input.now,
        input.settings,
      ) ?? contactRuleReason(input.contactHistory.get(customer.id) ?? [], input.now, input.presetKey, unit.vehicleId);
    if (reason) excluded[reason]++;
    else eligible.push({ customerId: unit.customerId, vehicleId: unit.vehicleId, lastVisitAt: unit.lastVisitAt });
  }

  // Most overdue first: stable, explainable order for previews and sampling.
  eligible.sort((a, b) => (a.lastVisitAt?.getTime() ?? 0) - (b.lastVisitAt?.getTime() ?? 0));
  return { matchedCustomers: byCustomer.size, eligible, excluded };
}
