import { addDays, pragueParts, pragueTime } from "../dates";

/**
 * Sending window (spec §12): Mon–Fri 9:00–18:00, Sat 9:00–12:00, Prague time,
 * never on Sundays or Czech public holidays.
 */

function easterSunday(year: number): { month: number; day: number } {
  // Anonymous Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const FIXED_HOLIDAYS = [
  "01-01",
  "05-01",
  "05-08",
  "07-05",
  "07-06",
  "09-28",
  "10-28",
  "11-17",
  "12-24",
  "12-25",
  "12-26",
];

export function isCzechHoliday(d: Date): boolean {
  const p = pragueParts(d);
  const key = `${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  if (FIXED_HOLIDAYS.includes(key)) return true;
  const easter = easterSunday(p.year);
  const sunday = pragueTime(p.year, easter.month, easter.day, 12);
  const goodFriday = pragueParts(addDays(sunday, -2));
  const easterMonday = pragueParts(addDays(sunday, 1));
  return (
    (p.month === goodFriday.month && p.day === goodFriday.day) ||
    (p.month === easterMonday.month && p.day === easterMonday.day)
  );
}

export function isWithinSendingWindow(d: Date): boolean {
  const p = pragueParts(d);
  if (p.weekday === 0 || isCzechHoliday(d)) return false;
  const minutes = p.hour * 60 + p.minute;
  if (p.weekday === 6) return minutes >= 9 * 60 && minutes < 12 * 60;
  return minutes >= 9 * 60 && minutes < 18 * 60;
}

/** The first allowed send time at or after `from`, rounded up to 15 minutes. */
export function nextSendingSlot(from: Date): Date {
  let t = new Date(Math.ceil(from.getTime() / 900_000) * 900_000);
  for (let i = 0; i < 24 * 4 * 14; i++) {
    if (isWithinSendingWindow(t)) return t;
    const p = pragueParts(t);
    // Jump to 9:00 of the next day once past today's window.
    if (p.hour >= 18 || (p.weekday === 6 && p.hour >= 12) || p.weekday === 0 || isCzechHoliday(t)) {
      const next = addDays(pragueTime(p.year, p.month, p.day, 12), 1);
      const n = pragueParts(next);
      t = pragueTime(n.year, n.month, n.day, 9, 0);
    } else {
      t = new Date(t.getTime() + 900_000);
    }
  }
  return t;
}

/** Default send time for a new campaign: the first sending slot from tomorrow, leaving time for approval. */
export function defaultCampaignSlot(now: Date = new Date()): Date {
  return nextSendingSlot(addDays(now, 1));
}
