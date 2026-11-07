import { pragueTime } from "./dates";

/**
 * Audit log filters (spec §23: filter by action and date). Parsed from the
 * URL, so a filtered view can be bookmarked; anything invalid is ignored.
 */

export const AUDIT_GROUPS = [
  "auth",
  "user",
  "company",
  "import",
  "customer",
  "campaign",
  "conversion",
  "dsr",
  "admin",
  "system",
] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilter {
  group: AuditGroup | null;
  /** Inclusive Prague calendar days, as YYYY-MM-DD. */
  from: string | null;
  to: string | null;
  page: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? v : null;
}

export function parseAuditFilter(params: Record<string, string | string[] | undefined>): AuditFilter {
  const one = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]);
  const group = one("akce");
  const page = Number(one("strana"));
  let from = validDay(one("od"));
  let to = validDay(one("do"));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    group: (AUDIT_GROUPS as readonly string[]).includes(group ?? "") ? (group as AuditGroup) : null,
    from,
    to,
    page: Number.isInteger(page) && page > 1 && page <= 1000 ? page : 1,
  };
}

/** Timestamp bounds for the query: from 00:00 of `from` to 00:00 after `to`, Prague time. */
export function auditRange(f: AuditFilter): { gte: string | null; lt: string | null } {
  const at = (day: string, plusDays = 0) => {
    const [y, m, d] = day.split("-").map(Number);
    const noon = new Date(Date.UTC(y, m - 1, d + plusDays, 12));
    return pragueTime(noon.getUTCFullYear(), noon.getUTCMonth() + 1, noon.getUTCDate(), 0, 0).toISOString();
  };
  return { gte: f.from ? at(f.from) : null, lt: f.to ? at(f.to, 1) : null };
}

/** The same filter on another page, as a query string. */
export function auditQuery(f: AuditFilter, page: number): string {
  const p = new URLSearchParams();
  if (f.group) p.set("akce", f.group);
  if (f.from) p.set("od", f.from);
  if (f.to) p.set("do", f.to);
  if (page > 1) p.set("strana", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Metadata shown in the log: IDs, counts and changed field names only (the
 * writer never stores personal data); long values are shortened.
 */
export function auditDetails(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      const text = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`;
    })
    .join(" · ");
}
