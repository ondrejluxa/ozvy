import { readFileSync } from "node:fs";
import { join } from "node:path";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildFixtures } from "@/supabase/seed/fixture-files";

/** The committed import fixtures (spec §31) match their generator and manifest. */

const dir = join(process.cwd(), "supabase", "seed", "fixtures");
const read = (name: string) => readFileSync(join(dir, name));
const manifest = JSON.parse(read("manifest.json").toString("utf8"));
const entry = (file: string) => manifest.files.find((f: { file: string }) => f.file === file);
const { files, manifest: generated } = buildFixtures();

describe("import fixtures", () => {
  it("are exactly what the generator produces (run `pnpm db:fixtures` after changing it)", () => {
    for (const file of files) expect(read(file.name).equals(file.bytes), file.name).toBe(true);
    expect(manifest).toEqual(JSON.parse(JSON.stringify(generated)));
  });

  it("are the same bytes in every time zone (Windows in Prague, CI in UTC)", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "Europe/Prague", "America/Los_Angeles", "Pacific/Auckland"]) {
        process.env.TZ = tz;
        // Guard: the zone switch really took effect in this worker.
        expect(new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset(), tz).toBe(
          { UTC: 0, "Europe/Prague": -120, "America/Los_Angeles": 420, "Pacific/Auckland": -720 }[tz],
        );
        for (const file of buildFixtures().files)
          expect(read(file.name).equals(file.bytes), `${file.name} in ${tz}`).toBe(true);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("Windows-1250 CSV: not UTF-8, semicolons, dd.mm.yyyy dates, '4 700 Kč' prices", () => {
    const m = entry("dvorak-export-cp1250.csv");
    const bytes = read(m.file);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toThrow();
    const text = iconv.decode(bytes, "win1250");
    expect(text).toContain("Číslo zákazníka;Jméno;Příjmení");
    expect(text).toMatch(/ř|ž|ů/);
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(m.dataRows + 1);
    expect(lines[0].split(";")).toEqual(m.header);
    const rows = lines.slice(1);
    expect(rows.every((l) => /;\d{2}\.\d{2}\.\d{4};/.test(l))).toBe(true);
    expect(rows.filter((l) => /;\d{1,3}( |\u00a0)\d{3}(,00)? Kč;/.test(l)).length).toBeGreaterThan(m.dataRows / 2);
    const nbspPrice = new RegExp(`${String.fromCharCode(0xa0)}\\d{3}(,00)? Kč`);
    expect(rows.filter((l) => nbspPrice.test(l))).toHaveLength(m.nbspPrices);
    expect(rows.filter((l) => l.includes('""'))).not.toHaveLength(0);
    expect(new Set(rows.map((l) => l.split(";")[0])).size).toBe(m.customers);
    expect(m.fixedLinePhones).toBeGreaterThan(0);
  });

  it("XLSX: two sheets, real dates, numeric phones, blank row and a summary row", () => {
    const m = entry("horak-export.xlsx");
    const wb = XLSX.read(read(m.file), { cellDates: true });
    expect(wb.SheetNames).toEqual(m.sheets);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[m.dataSheet], { header: 1, blankrows: true });
    expect(rows[0]).toEqual(m.header);
    const data = rows.slice(1, m.dataRows + 1);
    expect(data.every((r) => r[6] instanceof Date)).toBe(true);
    // Visit dates are whole days: the stored Excel serial has no time-of-day part.
    const raw = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(read(m.file)).Sheets[m.dataSheet], { header: 1 });
    expect(raw.slice(1, m.dataRows + 1).every((r) => Number.isInteger(r[6]))).toBe(true);
    expect(data.filter((r) => typeof r[2] === "number")).toHaveLength(m.numericPhoneCells);
    expect(rows[m.dataRows + 1]).toEqual([]);
    const summary = rows[m.summaryRow.sheetRow - 1];
    expect(summary[0]).toBe("Celkem");
    expect(summary[8]).toBe(m.summaryRow.totalPriceCzk);
    expect(data.reduce((s, r) => s + (r[8] as number), 0)).toBe(m.summaryRow.totalPriceCzk);
  });

  it("UTF-8 CSV: BOM, exact duplicates, malformed phones and an invalid date where the manifest says", () => {
    const m = entry("nadrazi-duplicates-utf8.csv");
    const text = read(m.file).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split("\n").filter(Boolean);
    expect(lines[0].split(",")).toEqual(m.header);
    const rows = lines.slice(1);
    expect(rows).toHaveLength(m.dataRows);
    for (const d of m.exactDuplicateRows) expect(rows[d.row - 1]).toBe(rows[d.duplicateOfRow - 1]);
    expect(new Set(rows).size).toBe(m.dataRows - m.exactDuplicateRows.length);
    for (const p of m.malformedPhones) expect(rows[p.row - 1]).toContain(`,${p.value},`);
    for (const d of m.invalidDates) expect(rows[d.row - 1]).toContain(`,${d.value},`);
    expect(m.rowsWithoutVehicle).toBeGreaterThan(m.dataRows * 0.15);
  });

  it("broken files really are broken", () => {
    const broken = iconv.decode(read("broken.csv"), "win1250").split("\r\n");
    expect(broken[2].split(";").length).toBeGreaterThan(broken[0].split(";").length);
    expect((broken[3].match(/"/g) ?? []).length % 2).toBe(1);
    expect(() => XLSX.read(read("truncated.xlsx"))).toThrow();
  });

  it("contain only example.cz / example.com e-mail addresses", () => {
    for (const name of ["dvorak-export-cp1250.csv", "nadrazi-duplicates-utf8.csv"]) {
      const text = iconv.decode(read(name), name.includes("cp1250") ? "win1250" : "utf8");
      const domains = new Set([...text.matchAll(/@([\w.-]+)/g)].map((x) => x[1]));
      expect([...domains].every((d) => d === "example.cz" || d === "example.com")).toBe(true);
    }
  });
});
