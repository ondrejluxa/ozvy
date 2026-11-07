import { addDays, toDateOnly } from "./dates";

/**
 * Data subject requests (spec §21). The operator records and completes them;
 * in managed mode a shop owner can only file access and erasure requests
 * (spec §20). The deadline is 30 days; the operator is alerted at day 20.
 */

export const DSR_TYPES = ["access", "erasure", "rectification", "objection"] as const;
export type DsrType = (typeof DSR_TYPES)[number];
export const OWNER_DSR_TYPES: DsrType[] = ["access", "erasure"];
export const DSR_DEADLINE_DAYS = 30;

export type DsrStatus = "open" | "completed" | "rejected";

/** The date a new request is due (Prague calendar day + 30). */
export function dsrDueDate(createdAt: Date): string {
  return toDateOnly(addDays(createdAt, DSR_DEADLINE_DAYS));
}

/** Days left until the deadline (negative when overdue). */
export function dsrDaysLeft(dueAt: string, now: Date): number {
  const today = toDateOnly(now);
  return Math.round((Date.parse(`${dueAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function canOwnerRequest(type: string): type is DsrType {
  return (OWNER_DSR_TYPES as string[]).includes(type);
}

// ---------- access export (spec §21: JSON + printable summary) ----------

export interface ExportSource {
  company: { name: string };
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    legalBasis: string | null;
    legalBasisSource: string | null;
    lifecycleStatus: string;
    lastVisitAt: string | null;
    createdAt: string;
  };
  vehicles: { brand: string | null; model: string | null; plate: string | null; year: number | null }[];
  visits: { visitedAt: string; service: string | null; jobValueMinor: number | null }[];
  messages: { sentAt: string | null; status: string; body: string; optedOutAt: string | null }[];
  conversions: { stage: string; bookedAt: string | null; completedAt: string | null; revenueMinor: number | null }[];
  suppressed: boolean;
}

export interface CustomerExport {
  format: "navrat.customer-export.v1";
  exportedAt: string;
  controller: string;
  processor: string;
  subject: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    legalBasis: string | null;
    legalBasisSource: string | null;
    status: string;
    lastVisit: string | null;
    recordCreated: string;
  };
  vehicles: ExportSource["vehicles"];
  visits: ExportSource["visits"];
  messages: ExportSource["messages"];
  bookingsAndJobs: ExportSource["conversions"];
  marketingObjection: boolean;
}

/**
 * Everything the shop (controller) holds about one person, through Návrat
 * (processor). Internal IDs are left out; the person's own data is complete.
 */
export function buildCustomerExport(src: ExportSource, now: Date): CustomerExport {
  const c = src.customer;
  return {
    format: "navrat.customer-export.v1",
    exportedAt: now.toISOString(),
    controller: src.company.name,
    processor: "Návrat",
    subject: {
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      legalBasis: c.legalBasis,
      legalBasisSource: c.legalBasisSource,
      status: c.lifecycleStatus,
      lastVisit: c.lastVisitAt,
      recordCreated: c.createdAt,
    },
    vehicles: src.vehicles,
    visits: [...src.visits].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)),
    messages: [...src.messages].sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "")),
    bookingsAndJobs: src.conversions,
    marketingObjection: src.suppressed,
  };
}

/** File name without personal data: shop-neutral, dated. */
export function exportFileName(customerId: string, now: Date): string {
  return `export-zakaznika-${customerId.slice(0, 8)}-${toDateOnly(now)}.json`;
}
