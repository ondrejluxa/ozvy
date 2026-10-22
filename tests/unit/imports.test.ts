import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_TYPES_RAW } from "@/lib/db/demo/fixtures";
import type { ServiceCategory } from "@/lib/db/types";
import { planCommit } from "@/lib/domain/imports/commit";
import { checkImportFile, detectDelimiter, detectEncoding, zipEntries } from "@/lib/domain/imports/detect";
import { issuesCsv, safeCell } from "@/lib/domain/imports/export";
import {
  applyTemplate,
  initialMapping,
  maskSample,
  mappingProblems,
  suggestMapping,
} from "@/lib/domain/imports/mapping";
import {
  categorizeService,
  normalizeBrand,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizePlate,
  normalizeVin,
  parseConsent,
  parseMoney,
  parseVisitDate,
  splitFullName,
  splitFullNameLastFirst,
  splitVehicle,
} from "@/lib/domain/imports/normalize";
import { ImportParseError, parseCsv, parseImportFile, parseXlsx } from "@/lib/domain/imports/parse";
import { countStatuses, looksLikeRealData, validateRows, type ExistingData } from "@/lib/domain/imports/validate";

const dir = join(process.cwd(), "supabase", "seed", "fixtures");
const read = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const entry = (file: string) => manifest.files.find((f: { file: string }) => f.file === file);
const TODAY = "2026-10-24";
const NONE: ExistingData = { customers: [], vehicles: [] };
const idFor = (key: string) => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const hash = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 24);

function validateFixture(name: string, type: "customers" | "visits" = "visits", existing = NONE) {
  const bytes = read(name);
  const check = checkImportFile({ name, size: bytes.length, bytes });
  if (!check.ok) throw new Error(check.issue);
  const parsed = parseImportFile(check.kind, bytes);
  const mapping = suggestMapping(parsed.header);
  const ragged = new Set(parsed.raggedRows);
  const results = validateRows({
    type,
    mapping,
    today: TODAY,
    existing,
    rows: parsed.rows.map((r) => ({ rowNumber: r.sourceRow, cells: r.cells, ragged: ragged.has(r.sourceRow) })),
  });
  return { parsed, mapping, results };
}

describe("file checks and detection", () => {
  it("accepts the fixtures and refuses broken or dangerous files", () => {
    for (const name of ["dvorak-export-cp1250.csv", "horak-export.xlsx", "nadrazi-duplicates-utf8.csv"]) {
      const bytes = read(name);
      expect(checkImportFile({ name, size: bytes.length, bytes }).ok, name).toBe(true);
    }
    const truncated = read("truncated.xlsx");
    expect(checkImportFile({ name: "truncated.xlsx", size: truncated.length, bytes: truncated })).toEqual({
      ok: false,
      issue: "unsupported_type",
    });
    const xlsx = read("horak-export.xlsx");
    expect(checkImportFile({ name: "makra.xlsm", size: xlsx.length, bytes: xlsx })).toEqual({
      ok: false,
      issue: "macro_enabled",
    });
    expect(checkImportFile({ name: "zakaznici.csv", size: xlsx.length, bytes: xlsx })).toEqual({
      ok: false,
      issue: "unsupported_type",
    });
    expect(checkImportFile({ name: "data.pdf", size: 10, bytes: new Uint8Array(10) }).ok).toBe(false);
    expect(checkImportFile({ name: "big.csv", size: 21 * 1024 * 1024, bytes: new Uint8Array(4) })).toEqual({
      ok: false,
      issue: "too_large",
    });
  });

  it("reads the zip directory without inflating (zip-bomb guard)", () => {
    const content = zipEntries(read("horak-export.xlsx"))!;
    expect(content.names).toContain("xl/workbook.xml");
    expect(content.uncompressed).toBeGreaterThan(0);
    expect(zipEntries(read("truncated.xlsx"))).toBeNull();
  });

  it("detects encodings and delimiters", () => {
    expect(detectEncoding(read("dvorak-export-cp1250.csv"))).toBe("windows-1250");
    expect(detectEncoding(read("nadrazi-duplicates-utf8.csv"))).toBe("utf-8-bom");
    expect(detectEncoding(new TextEncoder().encode("Jméno;Příjmení"))).toBe("utf-8");
    // Š and ž at ISO-8859-2 positions
    expect(detectEncoding(new Uint8Array([0x4a, 0xa9, 0x62, 0xbe, 0x3b, 0x61]))).toBe("iso-8859-2");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter('a,b,c\n"1;x",2,3')).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
});

describe("Windows-1250 CSV fixture", () => {
  const m = entry("dvorak-export-cp1250.csv");
  const { parsed, mapping, results } = validateFixture(m.file);

  it("parses every data row with the right header and mapping", () => {
    expect(parsed.encoding).toBe("windows-1250");
    expect(parsed.delimiter).toBe(";");
    expect(parsed.header).toEqual(m.header);
    expect(parsed.rows).toHaveLength(m.dataRows);
    expect(mapping).toMatchObject({
      external_customer_id: 0,
      first_name: 1,
      last_name: 2,
      phone: 3,
      email: 4,
      license_plate: 5,
      vin: 6,
      vehicle_brand: 7,
      vehicle_model: 8,
      visit_date: 9,
      service_type: 10,
      job_value: 11,
      notes: 12,
    });
    expect(mappingProblems(mapping, "visits")).toEqual([]);
  });

  it("reads every price format to the manifest total", () => {
    const total = parsed.rows.reduce((s, r) => s + (parseMoney(r.cells[11]).minor ?? 0), 0);
    expect(total).toBe(m.totalPriceCzk * 100);
  });

  it("flags fixed lines as warnings, keeps everyone else valid", () => {
    const counts = countStatuses(results);
    expect(counts.total).toBe(m.dataRows);
    expect(counts.duplicate).toBe(0);
    const fixed = new Set(
      results.filter((r) => r.issues.includes("fixed_line")).map((r) => r.normalized!.customer.external_id),
    );
    expect(fixed.size).toBe(m.fixedLinePhones);
    for (const r of results.filter((x) => x.status === "invalid")) expect(r.issues).toEqual(["no_contact"]);
  });

  it("plans one customer per customer number, one vehicle per plate", () => {
    const { batches, customerIds } = planCommit(results, {
      importId: "i1",
      declaredBasis: "existing_customer",
      recordedAt: "2026-10-24T10:00:00Z",
      existing: NONE,
      companyMappings: new Map(),
      idFor,
      hash,
    });
    const committable = results.filter((r) => r.status === "valid" || r.status === "warning");
    expect(customerIds).toHaveLength(new Set(committable.map((r) => r.normalized!.customer.external_id)).size);
    const vehicles = batches.flatMap((b) => b.vehicles);
    expect(new Set(vehicles.map((v) => v.id)).size).toBe(vehicles.length);
    expect(vehicles.length).toBe(new Set(committable.map((r) => r.normalized!.vehicle?.plate_norm)).size);
    expect(batches.flatMap((b) => b.visits)).toHaveLength(committable.length);
    expect(batches.flatMap((b) => b.customers).every((c) => c.legal_basis === "existing_customer")).toBe(true);
    expect(batches.every((b) => b.rowNumbers.length <= 500 + 10)).toBe(true);
  });
});

describe("two-sheet XLSX fixture", () => {
  const m = entry("horak-export.xlsx");
  const { parsed, mapping, results } = validateFixture(m.file);

  it("reads the first sheet, skips the blank and summary rows", () => {
    expect(parsed.sheetNames).toEqual(m.sheets);
    expect(parsed.sheet).toBe(m.dataSheet);
    expect(parsed.header).toEqual(m.header);
    expect(parsed.rows).toHaveLength(m.dataRows);
    expect(parsed.rows.some((r) => r.cells[0] === "Celkem")).toBe(false);
    expect(parseXlsx(read(m.file), { sheet: "Ceník" }).header).toEqual(["Služba", "Cena od", "Cena do"]);
  });

  it("maps surname-first names, combined vehicles, numeric phones and Excel dates", () => {
    expect(mapping).toMatchObject({
      full_name_last_first: 1,
      phone: 2,
      license_plate: 4,
      vehicle_full: 5,
      visit_date: 6,
    });
    const ok = results.filter((r) => r.normalized);
    // Rows without phone and e-mail are the only invalid ones.
    for (const r of results.filter((x) => !x.normalized)) expect(r.issues).toEqual(["no_contact"]);
    expect(ok.length).toBeGreaterThan(m.dataRows - 10);
    const first = ok[0].normalized!;
    expect(first.visit!.visited_at).toMatch(/^20\d\d-\d\d-\d\d$/);
    expect(first.vehicle!.brand).toBeTruthy();
    const surnameFirst = parsed.rows[0].cells[1].split(" ");
    expect(first.customer.last_name).toBe(surnameFirst[0]);
    expect(results.filter((r) => r.issues.includes("fixed_line")).length).toBeGreaterThan(0);
  });
});

describe("UTF-8 fixture with duplicates and malformed phones", () => {
  const m = entry("nadrazi-duplicates-utf8.csv");
  const { parsed, results } = validateFixture(m.file);
  // Data row k (manifest, header excluded) is source row k + 1.
  const row = (dataRow: number) => results.find((r) => r.rowNumber === dataRow + 1)!;

  it("parses a BOM file with commas", () => {
    expect(parsed.encoding).toBe("utf-8-bom");
    expect(parsed.delimiter).toBe(",");
    expect(parsed.rows).toHaveLength(m.dataRows);
  });

  it("marks exact duplicates", () => {
    for (const d of m.exactDuplicateRows) {
      const original = row(d.duplicateOfRow);
      if (original.status === "invalid") continue;
      expect(row(d.row).status, `row ${d.row}`).toBe("duplicate");
      expect(row(d.row).issues).toContain("duplicate_in_file");
    }
    expect(countStatuses(results).duplicate).toBeGreaterThanOrEqual(5);
  });

  it("explains every malformed phone and the invalid date", () => {
    for (const p of m.malformedPhones) {
      const r = row(p.row);
      if (p.reason === "foreign") {
        expect(r.issues).toContain("foreign_phone");
        expect(r.status).toBe("warning");
      } else {
        expect(r.issues, p.value).toContain("phone_unparseable");
        expect(r.status).toBe("invalid");
      }
    }
    for (const d of m.invalidDates) expect(row(d.row).issues).toContain("visit_date_invalid");
  });

  it("plans visits without vehicles for the sparse shop", () => {
    const { batches } = planCommit(results, {
      importId: "i3",
      declaredBasis: null,
      recordedAt: "2026-10-24T10:00:00Z",
      existing: NONE,
      companyMappings: new Map(),
      idFor,
      hash,
    });
    expect(batches.flatMap((b) => b.visits).some((v) => v.vehicle_id === null)).toBe(true);
    expect(batches.flatMap((b) => b.customers).every((c) => c.legal_basis === "unknown")).toBe(true);
  });
});

describe("broken files", () => {
  it("refuses an unclosed quote instead of half-importing", () => {
    expect(() => parseCsv(read("broken.csv"))).toThrow(ImportParseError);
    try {
      parseCsv(read("broken.csv"));
    } catch (e) {
      expect((e as ImportParseError).code).toBe("malformed_csv");
    }
  });

  it("flags ragged rows as invalid", () => {
    const text = "Jméno;Příjmení;Telefon\nJan;Novák;777123456\nEva;Svobodová;602456789;navíc\nKarel;Veselý\n";
    const parsed = parseCsv(new TextEncoder().encode(text));
    expect(parsed.raggedRows).toEqual([3, 4]);
  });
});

describe("re-import and matching", () => {
  const m = entry("dvorak-export-cp1250.csv");
  const first = validateFixture(m.file);
  const ctx = {
    importId: "i1",
    declaredBasis: "existing_customer" as const,
    recordedAt: "2026-10-24T10:00:00Z",
    existing: NONE,
    companyMappings: new Map<string, ServiceCategory>(),
    idFor,
    hash,
  };
  const plan1 = planCommit(first.results, ctx);

  it("matches existing customers by external ID and keeps visit keys stable", () => {
    const customers = plan1.batches.flatMap((b) => b.customers);
    const existing: ExistingData = {
      customers: customers.map((c) => ({
        id: c.id,
        externalId: c.external_id,
        phone: c.phone_e164,
        lastName: c.last_name,
        email: c.email,
      })),
      vehicles: plan1.batches.flatMap((b) =>
        b.vehicles.map((v) => ({ id: v.id, customerId: v.customer_id, plateNorm: v.license_plate_norm, vin: v.vin })),
      ),
    };
    const second = validateFixture(m.file, "visits", existing);
    expect(second.results.filter((r) => r.normalized).every((r) => r.matchCustomerId !== null)).toBe(true);
    const plan2 = planCommit(second.results, { ...ctx, importId: "i2", existing });
    // Same customers, same vehicles, same visit keys: the database upsert updates instead of duplicating.
    expect(plan2.customerIds.sort()).toEqual(plan1.customerIds.sort());
    expect(plan2.batches.flatMap((b) => b.vehicles.map((v) => v.id)).sort()).toEqual(
      plan1.batches.flatMap((b) => b.vehicles.map((v) => v.id)).sort(),
    );
    expect(plan2.batches.flatMap((b) => b.visits.map((v) => v.external_ref)).sort()).toEqual(
      plan1.batches.flatMap((b) => b.visits.map((v) => v.external_ref)).sort(),
    );
  });

  it("flags ambiguous matches and never merges them", () => {
    const twins: ExistingData = {
      customers: [
        { id: "c1", externalId: null, phone: "+420777123456", lastName: "Novák", email: null },
        { id: "c2", externalId: null, phone: "+420777123456", lastName: "Novák", email: null },
      ],
      vehicles: [],
    };
    const [r] = validateRows({
      type: "customers",
      mapping: { first_name: 0, last_name: 1, phone: 2 },
      today: TODAY,
      existing: twins,
      rows: [{ rowNumber: 2, cells: ["Jan", "NOVÁK", "777 123 456"] }],
    });
    expect(r).toMatchObject({ status: "warning", ambiguous: true, matchCustomerId: null });
    expect(r.issues).toContain("ambiguous_match");
    expect(planCommit([r], { ...ctx, existing: twins }).customerIds).toEqual([]);
  });

  it("customer imports: duplicates by phone + surname and by e-mail, one synthetic visit", () => {
    const results = validateRows({
      type: "customers",
      mapping: { full_name: 0, phone: 1, email: 2, visit_date: 3, service_type: 4 },
      today: TODAY,
      existing: NONE,
      rows: [
        { rowNumber: 2, cells: ["Jana Nováková", "777123456", "jana@example.cz", "1.3.2025", "Servis"] },
        { rowNumber: 3, cells: ["Jana Nováková", "+420 777 123 456", "", "", ""] },
        { rowNumber: 4, cells: ["Eva Malá", "", "JANA@example.cz", "", ""] },
        { rowNumber: 5, cells: ["Petr Malý", "", "", "", ""], excluded: true },
        { rowNumber: 6, cells: ["Ivo Bílý", "777000111", "", "1.3.2030", "Servis"] },
      ],
    });
    expect(results.map((r) => r.status)).toEqual(["valid", "duplicate", "duplicate", "excluded", "invalid"]);
    expect(results[0].normalized!.visit).toEqual({
      visited_at: "2025-03-01",
      service_type_raw: "Servis",
      job_value_minor: null,
    });
    expect(results[4].issues).toContain("visit_date_future");
  });
});

describe("field normalisation", () => {
  it("names", () => {
    expect(normalizeName("  NOVÁK   jan ")).toBe("NOVÁK jan");
    expect(normalizeName("JANA NOVÁKOVÁ-SVOBODOVÁ")).toBe("Jana Nováková-Svobodová");
    expect(splitFullName("Jan Pavel Novák")).toEqual({ first: "Jan Pavel", last: "Novák" });
    expect(splitFullNameLastFirst("Nováková Jana")).toEqual({ first: "Jana", last: "Nováková" });
    expect(splitFullName("Novák")).toEqual({ first: null, last: "Novák" });
  });

  it("phones", () => {
    expect(normalizePhone("777 123 456")).toEqual({ e164: "+420777123456", type: "mobile", issue: null });
    expect(normalizePhone("00420777123456").e164).toBe("+420777123456");
    expect(normalizePhone("321 724 118")).toMatchObject({ type: "fixed", issue: "fixed_line" });
    expect(normalizePhone("+421 905 123 456")).toMatchObject({ e164: "+421905123456", issue: "foreign_phone" });
    expect(normalizePhone("12345").issue).toBe("phone_unparseable");
    expect(normalizePhone("").issue).toBeNull();
  });

  it("e-mails", () => {
    expect(normalizeEmail(" Jana@Example.CZ ")).toEqual({ email: "jana@example.cz", issue: null });
    expect(normalizeEmail("info@example.cz").issue).toBe("email_suspicious");
    expect(normalizeEmail("jana@")).toEqual({ email: null, issue: "email_suspicious" });
  });

  it("dates", () => {
    expect(parseVisitDate("25.9.2026", TODAY)).toEqual({ date: "2026-09-25", issue: null });
    expect(parseVisitDate("25. 9. 2026", TODAY).date).toBe("2026-09-25");
    expect(parseVisitDate("05.03.2024", TODAY).date).toBe("2024-03-05");
    expect(parseVisitDate("2026-09-25", TODAY).date).toBe("2026-09-25");
    expect(parseVisitDate("46290", TODAY).date).toBe("2026-09-25"); // Excel serial
    expect(parseVisitDate("31.2.2024", TODAY).issue).toBe("visit_date_invalid");
    expect(parseVisitDate("1.1.2027", TODAY).issue).toBe("visit_date_future");
    expect(parseVisitDate("1.1.2015", TODAY)).toEqual({ date: "2015-01-01", issue: "visit_too_old" });
  });

  it("money", () => {
    expect(parseMoney("4 700 Kč").minor).toBe(470_000);
    expect(parseMoney("4700,00").minor).toBe(470_000);
    expect(parseMoney("4.700,-").minor).toBe(470_000);
    expect(parseMoney(`12${String.fromCharCode(0xa0)}350,00 Kč`).minor).toBe(1_235_000);
    expect(parseMoney("1500").minor).toBe(150_000);
    expect(parseMoney("1.5").minor).toBe(150);
    expect(parseMoney("250 000 Kč").issue).toBe("job_value_out_of_range");
    expect(parseMoney("0").issue).toBe("job_value_out_of_range");
    expect(parseMoney("zdarma").issue).toBe("job_value_invalid");
  });

  it("plates, VINs, brands and consent", () => {
    expect(normalizePlate(" 2s4  7710 ")).toEqual({ display: "2S4 7710", norm: "2S47710" });
    expect(normalizeVin("tmbjj7ne5l0123456")).toEqual({ vin: "TMBJJ7NE5L0123456", issue: null });
    expect(normalizeVin("TMBJJ7NE5L012345O").issue).toBe("vin_malformed");
    expect(normalizeBrand("SKODA")).toBe("Škoda");
    expect(normalizeBrand("Škoda auto")).toBe("Škoda");
    expect(normalizeBrand("vw")).toBe("Volkswagen");
    expect(splitVehicle("Mercedes-Benz E 220")).toEqual({ brand: "Mercedes-Benz", model: "E 220" });
    expect(splitVehicle("Land Rover Discovery")).toEqual({ brand: "Land Rover", model: "Discovery" });
    expect(["ano", "A", "yes", "1", "TRUE", "x"].every(parseConsent)).toBe(true);
    expect(["ne", "", "0", "no"].some(parseConsent)).toBe(false);
  });

  it("service categories: company mapping, keyword rules, else repair_other", () => {
    const none = new Map<string, ServiceCategory>();
    for (const [category, labels] of Object.entries(SERVICE_TYPES_RAW) as [ServiceCategory, string[]][]) {
      if (category === "repair_other") continue;
      for (const label of labels) expect(categorizeService(label, none), label).toBe(category);
    }
    expect(categorizeService("Geometrie", none)).toBe("repair_other");
    expect(categorizeService(null, none)).toBe("repair_other");
    expect(categorizeService("Geometrie", new Map([["geometrie", "tyre_change"]]))).toBe("tyre_change");
  });
});

describe("mapping templates, masking, export", () => {
  it("re-applies a saved template by header name", () => {
    const template = { mapping: { phone: 2, last_name: 1 }, header: ["Jméno", "Příjmení", "Telefon"] };
    expect(applyTemplate(template, ["Telefon", "Jmeno", "Prijmeni"])).toEqual({ phone: 0, last_name: 2 });
    expect(applyTemplate(template, ["Úplně", "jiné"])).toBeNull();
    expect(mappingProblems({ phone: 0 }, "visits")).toEqual(["name_required", "visit_date_required"]);
    expect(mappingProblems({ last_name: 0, phone: 0 }, "customers")).toEqual(["duplicate_column"]);
  });

  it("masks sample values before an AI hint", () => {
    expect(maskSample("Jana Nováková")).toBe("Xxxx Xxxxxxxx");
    expect(maskSample("+420 777 123 456")).toBe("+999 999 999 999");
    expect(maskSample("jana@example.cz")).toBe("xxxx@xxxxxxx.xx");
  });

  it("neutralises spreadsheet formulas in the error CSV", () => {
    expect(safeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(safeCell("+420777")).toBe("'+420777");
    expect(safeCell('a;"b"')).toBe('"a;""b"""');
    const csv = issuesCsv(["Jméno"], [{ rowNumber: 3, status: "invalid", issues: ["no_contact"], cells: ["@SUM"] }], {
      row: "Řádek",
      status: "Stav",
      issues: "Problémy",
      statusLabel: (s) => s,
      issueLabel: (i) => i,
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("3;invalid;no_contact;'@SUM");
  });

  it("detects real-looking data outside production", () => {
    expect(looksLikeRealData(["a@example.cz", null, "b@example.com"])).toBe(false);
    expect(looksLikeRealData(["jan.novak@seznam.cz"])).toBe(true);
  });
});

describe("initialMapping", () => {
  it("completes a partly matching template with header suggestions", () => {
    const template = { mapping: { first_name: 0, visit_date: 3 }, header: ["Jméno", "x", "y", "Datum zakázky"] };
    const result = initialMapping(template, ["Jméno", "Příjmení", "Telefon", "Datum"]);
    expect(result).toEqual({
      mapping: { first_name: 0, last_name: 1, phone: 2, visit_date: 3 },
      templateApplied: true,
    });
    expect(initialMapping(null, ["Telefon"])).toEqual({ mapping: { phone: 0 }, templateApplied: false });
  });
});
