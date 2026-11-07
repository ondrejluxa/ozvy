/**
 * Date helpers. All business dates are evaluated in the company timezone
 * (Europe/Prague for every Czech shop) and displayed in Czech format:
 * "25. 9. 2026", "14:30", "před 3 dny".
 */

export const TZ = "Europe/Prague";
export const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 30.4375;

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const monthShortFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, month: "short" });
const monthLongFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, month: "long", year: "numeric" });
const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" });
const rtf = new Intl.RelativeTimeFormat("cs", { numeric: "auto" });

/** Czech locative month names for "v březnu", "loni v září". */
const MONTH_LOCATIVE = [
  "lednu",
  "únoru",
  "březnu",
  "dubnu",
  "květnu",
  "červnu",
  "červenci",
  "srpnu",
  "září",
  "říjnu",
  "listopadu",
  "prosinci",
];

type DateInput = Date | string | number;
const toDate = (d: DateInput) => (d instanceof Date ? d : new Date(d));

export interface PragueParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function pragueParts(d: DateInput): PragueParts {
  const parts = Object.fromEntries(partsFmt.formatToParts(toDate(d)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** "2026-10" in Prague time. */
export function monthKey(d: DateInput): string {
  const p = pragueParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Last `count` month keys ending with the month of `now`, oldest first. */
export function lastMonthKeys(now: DateInput, count: number): string[] {
  const current = monthKey(now);
  return Array.from({ length: count }, (_, i) => shiftMonthKey(current, i - (count - 1)));
}

function offsetMinutesAt(d: Date): number {
  const name = offsetFmt.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** The instant a Prague wall-clock time occurs (DST aware). */
export function pragueTime(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = offsetMinutesAt(new Date(guess));
  return new Date(guess - offset * 60_000);
}

export function monthStart(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return pragueTime(y, m, 1);
}

export function monthEnd(key: string): Date {
  return new Date(monthStart(shiftMonthKey(key, 1)).getTime() - 1);
}

export function addDays(d: DateInput, days: number): Date {
  return new Date(toDate(d).getTime() + days * DAY_MS);
}

export function daysBetween(from: DateInput, to: DateInput): number {
  return (toDate(to).getTime() - toDate(from).getTime()) / DAY_MS;
}

/** Fractional months between two instants, used by lifecycle and segment rules. */
export function monthsBetween(from: DateInput, to: DateInput): number {
  return daysBetween(from, to) / AVG_MONTH_DAYS;
}

/** "2026-10-05" for a Prague calendar date. */
export function toDateOnly(d: DateInput): string {
  const p = pragueParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Interprets a date-only value as midday of that calendar day (11:00 UTC is
 * 12:00 or 13:00 in Prague). Cheap enough for hot loops over visit history.
 */
export function fromDateOnly(s: string): Date {
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), 11));
}

export const formatDate = (d: DateInput) => dateFmt.format(toDate(d));
export const formatTime = (d: DateInput) => timeFmt.format(toDate(d));
export const formatDateTime = (d: DateInput) => `${formatDate(d)} ${formatTime(d)}`;

export function formatMonthShort(key: string): string {
  return monthShortFmt.format(monthStart(key)).replace(".", "");
}

export function formatMonthLong(key: string): string {
  return monthLongFmt.format(addDays(monthStart(key), 1));
}

/** "před 3 dny", "včera", "za 2 hodiny". */
export function formatRelative(d: DateInput, now: DateInput): string {
  const diffMs = toDate(d).getTime() - toDate(now).getTime();
  const abs = Math.abs(diffMs);
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (abs < DAY_MS) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  if (abs < 30 * DAY_MS) return rtf.format(Math.round(diffMs / DAY_MS), "day");
  if (abs < 365 * DAY_MS) return rtf.format(Math.round(diffMs / (AVG_MONTH_DAYS * DAY_MS)), "month");
  return rtf.format(Math.round(diffMs / (365.25 * DAY_MS)), "year");
}

/**
 * Natural Czech phrase for the {{posledni_navsteva}} placeholder:
 * "loni v září", "letos v březnu", "v březnu 2024".
 */
export function describeLastVisit(visit: DateInput, now: DateInput): string {
  const v = pragueParts(visit);
  const n = pragueParts(now);
  const month = MONTH_LOCATIVE[v.month - 1];
  if (v.year === n.year) return `letos v ${month}`;
  if (v.year === n.year - 1) return `loni v ${month}`;
  return `v ${month} ${v.year}`;
}
