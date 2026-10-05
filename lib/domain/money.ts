/** Money is stored as integer haléře (1 Kč = 100 haléřů) and formatted only here. */

const czk = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  maximumFractionDigits: 0,
});

const czkPrecise = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("cs-CZ", { style: "percent", maximumFractionDigits: 1 });

export const toMinor = (czkAmount: number) => Math.round(czkAmount * 100);
export const fromMinor = (minor: number) => minor / 100;

export function formatCZK(minor: number): string {
  return czk.format(fromMinor(minor));
}

/** For per-segment prices such as 0,90 Kč. */
export function formatCZKPrecise(minor: number): string {
  return czkPrecise.format(fromMinor(minor));
}

export function formatInt(n: number): string {
  return integer.format(n);
}

/** ROI multiple, e.g. 10,5×. Returns an em dash when undefined. */
export function formatROI(roi: number | null): string {
  return roi === null ? "—" : `${oneDecimal.format(roi)}×`;
}

export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

/** Rounds an expected-revenue estimate to a believable figure (~18 000 Kč). */
export function roundEstimateMinor(minor: number): number {
  const czkAmount = fromMinor(minor);
  const step = czkAmount >= 10_000 ? 1_000 : 100;
  return toMinor(Math.round(czkAmount / step) * step);
}
