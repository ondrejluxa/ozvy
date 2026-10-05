import type { Conversion, Message, MessageStatus } from "../../db/types";
import { monthKey } from "../dates";

/**
 * KPI definitions (spec §9, §14). Every figure derives from conversions and
 * messages; nothing is stored as a mutable total. Holdout conversions are
 * recorded but never count as recovered revenue.
 */

export type ConversionLite = Pick<
  Conversion,
  "customer_id" | "campaign_id" | "stage" | "is_holdout" | "booked_at" | "completed_at" | "revenue_minor"
>;
export type MessageLite = Pick<Message, "status" | "sent_at">;

export const SENT_OR_LATER: MessageStatus[] = ["sent", "delivered", "undelivered", "expired"];

export function countsAsRecovered(c: ConversionLite): boolean {
  return c.stage === "completed" && !c.is_holdout && c.revenue_minor !== null && c.completed_at !== null;
}

export function recoveredRevenue(conversions: ConversionLite[], month?: string): number {
  return conversions
    .filter((c) => countsAsRecovered(c) && (!month || monthKey(c.completed_at!) === month))
    .reduce((sum, c) => sum + (c.revenue_minor ?? 0), 0);
}

export function roi(revenueMinor: number, subscriptionMinor: number): number | null {
  return subscriptionMinor > 0 ? revenueMinor / subscriptionMinor : null;
}

export interface MonthlyKpis {
  month: string;
  recoveredRevenueMinor: number;
  reactivatedCustomers: number;
  bookings: number;
  messagesSent: number;
  subscriptionMinor: number;
  roi: number | null;
}

export function monthlyKpis(
  conversions: ConversionLite[],
  messages: MessageLite[],
  month: string,
  subscriptionMinor: number,
): MonthlyKpis {
  const completed = conversions.filter((c) => countsAsRecovered(c) && monthKey(c.completed_at!) === month);
  const revenue = completed.reduce((sum, c) => sum + (c.revenue_minor ?? 0), 0);
  return {
    month,
    recoveredRevenueMinor: revenue,
    reactivatedCustomers: new Set(completed.map((c) => c.customer_id)).size,
    bookings: conversions.filter(
      (c) =>
        !c.is_holdout &&
        (c.stage === "booked" || c.stage === "completed") &&
        c.booked_at !== null &&
        monthKey(c.booked_at) === month,
    ).length,
    messagesSent: messages.filter(
      (m) => SENT_OR_LATER.includes(m.status) && m.sent_at !== null && monthKey(m.sent_at) === month,
    ).length,
    subscriptionMinor,
    roi: roi(revenue, subscriptionMinor),
  };
}

/** Relative change, or null when the previous value is zero. */
export function delta(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null;
}

export interface HoldoutComparison {
  sufficient: boolean;
  treatedRate: number;
  holdoutRate: number;
  incrementalMinor: number;
}

/**
 * Incremental revenue = (r_treated − r_holdout) × n_treated × avg job value.
 * Only meaningful with at least 30 holdout customers (spec §14).
 */
export function holdoutComparison(input: {
  treatedCount: number;
  treatedCompleted: number;
  treatedRevenueMinor: number;
  holdoutCount: number;
  holdoutCompleted: number;
}): HoldoutComparison {
  const treatedRate = input.treatedCount ? input.treatedCompleted / input.treatedCount : 0;
  const holdoutRate = input.holdoutCount ? input.holdoutCompleted / input.holdoutCount : 0;
  const avgJob = input.treatedCompleted ? input.treatedRevenueMinor / input.treatedCompleted : 0;
  return {
    sufficient: input.holdoutCount >= 30,
    treatedRate,
    holdoutRate,
    incrementalMinor: Math.max(0, Math.round((treatedRate - holdoutRate) * input.treatedCount * avgJob)),
  };
}
