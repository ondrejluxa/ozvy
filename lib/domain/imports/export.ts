/**
 * "Stáhnout chyby": rows with problems as a CSV for Czech Excel (UTF-8 BOM,
 * semicolons). Cells that a spreadsheet would treat as a formula are
 * prefixed with a quote (spec §22, CSV injection).
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function safeCell(value: string): string {
  const v = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function issuesCsv(
  header: string[],
  rows: { rowNumber: number; status: string; issues: string[]; cells: string[] }[],
  labels: {
    row: string;
    status: string;
    issues: string;
    statusLabel: (s: string) => string;
    issueLabel: (i: string) => string;
  },
): string {
  const lines = [[labels.row, labels.status, labels.issues, ...header].map(safeCell).join(";")];
  for (const r of rows) {
    lines.push(
      [
        String(r.rowNumber),
        labels.statusLabel(r.status),
        r.issues.map(labels.issueLabel).join(", "),
        ...header.map((_, i) => r.cells[i] ?? ""),
      ]
        .map(safeCell)
        .join(";"),
    );
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}
