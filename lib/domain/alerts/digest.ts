/**
 * Daily 06:00 operator digest (spec §25): alerts opened and resolved in the
 * last 24 h, messages sent, failures, campaigns scheduled today. When all is
 * well the subject says so: "Vše v pořádku · 3 kampaně dnes".
 */

export interface DigestInput {
  openAlerts: number;
  opened24h: { company: string; type: string }[];
  resolved24h: number;
  sent24h: number;
  failed24h: number;
  campaignsToday: { company: string; name: string; at: string }[];
  /** Czech alert titles by type, for the body. */
  titles: Record<string, string>;
  appUrl: string;
}

/** 1 kampaň, 2–4 kampaně, 0 / 5+ kampaní. */
export function campaignsCount(n: number): string {
  if (n === 1) return "1 kampaň";
  if (n >= 2 && n <= 4) return `${n} kampaně`;
  return `${n} kampaní`;
}

/** 1 upozornění, 2–4 upozornění … (indeclinable), kept as a helper for clarity. */
function alertsCount(n: number): string {
  return `${n} ${n === 1 ? "upozornění" : "upozornění"}`;
}

export function digestSubject(input: Pick<DigestInput, "openAlerts" | "campaignsToday">): string {
  const today = `${campaignsCount(input.campaignsToday.length)} dnes`;
  return input.openAlerts === 0
    ? `Vše v pořádku · ${today}`
    : `Vyžaduje pozornost: ${alertsCount(input.openAlerts)} · ${today}`;
}

export function digestText(input: DigestInput): string {
  const lines = [
    digestSubject(input),
    "",
    `Za posledních 24 hodin: odesláno ${input.sent24h} SMS, nedoručeno nebo selhalo ${input.failed24h}.`,
    `Nová upozornění: ${input.opened24h.length}, vyřešená: ${input.resolved24h}, otevřená celkem: ${input.openAlerts}.`,
  ];
  if (input.opened24h.length) {
    lines.push("", "Nová upozornění:");
    for (const a of input.opened24h) lines.push(`- ${a.company}: ${input.titles[a.type] ?? a.type}`);
  }
  lines.push(
    "",
    input.campaignsToday.length ? "Kampaně naplánované na dnešek:" : "Na dnešek není naplánovaná žádná kampaň.",
  );
  for (const c of input.campaignsToday) lines.push(`- ${c.at} · ${c.company} · ${c.name}`);
  lines.push("", `Přehled: ${input.appUrl}/admin`);
  return lines.join("\n");
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function digestHtml(input: DigestInput): string {
  const paragraphs = digestText(input)
    .split("\n\n")
    .map((block) => `<p>${escape(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1c1917">${paragraphs}</div>`;
}
