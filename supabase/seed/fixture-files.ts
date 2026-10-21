import iconv from "iconv-lite";
import * as XLSX from "xlsx";
import {
  BRANDS,
  FIRST_NAMES_FEMALE,
  FIRST_NAMES_MALE,
  JOB_VALUE_CZK,
  MOBILE_PREFIXES,
  PLATE_LETTERS,
  SERVICE_TYPES_RAW,
  SURNAMES,
  VIN_CHARS,
} from "../../lib/db/demo/fixtures";
import type { ServiceCategory } from "../../lib/db/types";

/**
 * Messy import fixtures (spec §31, §30), written to supabase/seed/fixtures by
 * `pnpm db:fixtures` and committed. Fully deterministic: a fixed PRNG seed
 * and fixed dates, so regenerating gives the same files. Every person,
 * phone, plate and VIN is fictional; emails use example.cz / example.com.
 *
 * The manifest records the ground truth of each file (row counts,
 * duplicates, malformed values with their data-row numbers, 1-based without
 * the header) for the import tests of slice 7.
 */

const SEED = 31_031;
const HISTORY_END = Date.UTC(2026, 8, 30); // 30. 9. 2026
const DAY = 86_400_000;

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Rand = () => number;
const int = (r: Rand, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rand, items: readonly T[]) => items[Math.floor(r() * items.length)];
const digits = (r: Rand, n: number) => Array.from({ length: n }, () => int(r, 0, 9)).join("");
const deaccent = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const pad2 = (n: number) => String(n).padStart(2, "0");

interface Job {
  customerNo: string;
  firstName: string;
  lastName: string;
  /** National 9 digits, or null when missing. */
  phone: string | null;
  fixedLine: boolean;
  email: string | null;
  plate: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  date: Date;
  work: string;
  category: ServiceCategory;
  priceCzk: number;
}

interface WorldOptions {
  customers: number;
  regionLetter: string;
  fixedPrefixes: string[];
  fixedShare: number;
  missingVehicleShare: number;
  tyreHeavy: boolean;
  customerNoPrefix: string;
}

function categoryFor(r: Rand, tyreHeavy: boolean): ServiceCategory {
  const weights: [ServiceCategory, number][] = [
    ["regular_service", tyreHeavy ? 22 : 30],
    ["oil_change", 15],
    ["tyre_change", tyreHeavy ? 38 : 18],
    ["tyre_storage", tyreHeavy ? 12 : 4],
    ["ac_service", 5],
    ["brakes", 8],
    ["diagnostics", 6],
    ["stk", 6],
    ["repair_other", 8],
  ];
  let roll = r() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [category, w] of weights) if ((roll -= w) < 0) return category;
  return "repair_other";
}

/** Customers with one or two cars and 1–5 jobs each, newest last. */
function buildJobs(r: Rand, o: WorldOptions): Job[] {
  const jobs: Job[] = [];
  const brandTotal = BRANDS.reduce((s, b) => s + b.weight, 0);
  for (let i = 0; i < o.customers; i++) {
    const female = r() < 0.48;
    const [maleSurname, femaleSurname] = pick(r, SURNAMES);
    const firstName = pick(r, female ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE);
    const lastName = female ? femaleSurname : maleSurname;
    const fixedLine = r() < o.fixedShare;
    const phone =
      r() < 0.97 ? `${fixedLine ? pick(r, o.fixedPrefixes) : pick(r, MOBILE_PREFIXES)}${digits(r, 6)}` : null;
    const email =
      r() < 0.5
        ? `${deaccent(firstName).toLowerCase()}.${deaccent(lastName).toLowerCase()}@${pick(r, ["example.cz", "example.com"])}`
        : null;
    const cars = r() < o.missingVehicleShare ? 0 : r() < 0.15 ? 2 : 1;
    for (let c = 0; c < Math.max(1, cars); c++) {
      let roll = r() * brandTotal;
      const brand = BRANDS.find((b) => (roll -= b.weight) < 0) ?? BRANDS[0];
      const third = r() < 0.7 ? String(int(r, 0, 9)) : pick(r, PLATE_LETTERS.split(""));
      const plate = cars ? `${int(r, 1, 9)}${o.regionLetter}${third} ${digits(r, 4)}` : null;
      const vin =
        cars && r() < 0.6
          ? pick(r, brand.wmi) + Array.from({ length: 14 }, () => pick(r, VIN_CHARS.split(""))).join("")
          : null;
      const count = int(r, 1, 5);
      let date = HISTORY_END - int(r, 5, 900) * DAY;
      const dates: number[] = [];
      for (let k = 0; k < count && date > HISTORY_END - 5 * 365 * DAY; k++) {
        dates.unshift(date);
        date -= int(r, 150, 420) * DAY;
      }
      for (const d of dates) {
        const category = categoryFor(r, o.tyreHeavy);
        const [min, max] = JOB_VALUE_CZK[category];
        jobs.push({
          customerNo: `${o.customerNoPrefix}${String(1_000 + i).padStart(5, "0")}`,
          firstName,
          lastName,
          phone,
          fixedLine: phone !== null && fixedLine,
          email,
          plate,
          vin,
          brand: cars ? brand.brand : null,
          model: cars ? pick(r, brand.models) : null,
          date: new Date(d),
          work: pick(r, SERVICE_TYPES_RAW[category]),
          category,
          priceCzk: Math.round((min + r() * (max - min)) / 50) * 50,
        });
      }
    }
  }
  return jobs.sort((a, b) => a.date.getTime() - b.date.getTime() || a.customerNo.localeCompare(b.customerNo));
}

const csvField = (value: string, delimiter: string) =>
  value.includes(delimiter) || value.includes('"') || value.includes("\n") ? `"${value.replace(/"/g, '""')}"` : value;

/** "4 700 Kč" with a plain or non-breaking thousands space, sometimes with ",00". */
function czkText(r: Rand, czk: number): { text: string; nbsp: boolean; decimals: boolean } {
  const nbsp = r() < 0.25;
  const decimals = r() < 0.15;
  const grouped = String(czk).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp ? "\u00a0" : " ");
  return { text: `${grouped}${decimals ? ",00" : ""} Kč`, nbsp: nbsp && czk >= 1_000, decimals };
}

function phoneText(r: Rand, national: string): string {
  const spaced = `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  const roll = r();
  if (roll < 0.4) return spaced;
  if (roll < 0.7) return `+420 ${spaced}`;
  if (roll < 0.9) return national;
  return `00420${national}`;
}

// ---------- 1. Windows-1250, semicolon, dd.mm.yyyy, "4 700 Kč" ----------

function windows1250Csv() {
  const r = prng(SEED + 1);
  const jobs = buildJobs(r, {
    customers: 120,
    regionLetter: "S",
    fixedPrefixes: ["321"],
    fixedShare: 0.08,
    missingVehicleShare: 0,
    tyreHeavy: false,
    customerNoPrefix: "K",
  });
  const header = [
    "Číslo zákazníka",
    "Jméno",
    "Příjmení",
    "Telefon",
    "E-mail",
    "SPZ",
    "VIN",
    "Značka",
    "Model",
    "Datum zakázky",
    "Popis práce",
    "Cena",
    "Poznámka",
  ];
  const notes = ['Zákazník volá "až po 16:00"', "Náhradní vůz; vrátit do pátku", "Platba kartou"];
  const stats = { nbspPrices: 0, decimalPrices: 0, emptyPrices: 0, quotedNotes: 0, totalPriceCzk: 0 };
  const lines = [header.join(";")];
  for (const j of jobs) {
    const empty = r() < 0.03;
    const price = czkText(r, j.priceCzk);
    if (empty) stats.emptyPrices++;
    else {
      stats.totalPriceCzk += j.priceCzk;
      if (price.nbsp) stats.nbspPrices++;
      if (price.decimals) stats.decimalPrices++;
    }
    const note = r() < 0.05 ? pick(r, notes) : "";
    if (note) stats.quotedNotes++;
    const d = j.date;
    lines.push(
      [
        j.customerNo,
        j.firstName,
        j.lastName,
        j.phone ? phoneText(r, j.phone) : "",
        j.email ?? "",
        j.plate ?? "",
        j.vin ?? "",
        j.brand ?? "",
        j.model ?? "",
        `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`,
        j.work,
        empty ? "" : price.text,
        note,
      ]
        .map((v) => csvField(v, ";"))
        .join(";"),
    );
  }
  const text = lines.join("\r\n") + "\r\n";
  return {
    bytes: iconv.encode(text, "win1250"),
    manifest: {
      file: "dvorak-export-cp1250.csv",
      encoding: "windows-1250",
      delimiter: ";",
      lineEnding: "CRLF",
      dateFormat: "dd.mm.yyyy",
      header,
      dataRows: jobs.length,
      customers: new Set(jobs.map((j) => j.customerNo)).size,
      vehicles: new Set(jobs.map((j) => j.plate)).size,
      fixedLinePhones: new Set(jobs.filter((j) => j.fixedLine).map((j) => j.customerNo)).size,
      missingPhones: new Set(jobs.filter((j) => !j.phone).map((j) => j.customerNo)).size,
      ...stats,
    },
  };
}

// ---------- 2. XLSX: two sheets, summary row, numeric phones ----------

function twoSheetXlsx() {
  const r = prng(SEED + 2);
  const jobs = buildJobs(r, {
    customers: 90,
    regionLetter: "B",
    fixedPrefixes: ["541", "543", "545", "547"],
    fixedShare: 0.26,
    missingVehicleShare: 0,
    tyreHeavy: true,
    customerNoPrefix: "H",
  });
  const header = [
    "Zákazník č.",
    "Příjmení a jméno",
    "Mobil",
    "Email",
    "RZ",
    "Vozidlo",
    "Datum",
    "Služba",
    "Cena s DPH",
  ];
  let numericPhones = 0;
  const rows: (string | number | Date | null)[][] = jobs.map((j) => {
    const numeric = j.phone !== null && r() < 0.4;
    if (numeric) numericPhones++;
    return [
      j.customerNo,
      `${j.lastName} ${j.firstName}`,
      j.phone === null ? null : numeric ? Number(j.phone) : phoneText(r, j.phone),
      j.email,
      j.plate,
      `${j.brand} ${j.model}`,
      j.date,
      j.work,
      j.priceCzk,
    ];
  });
  const total = jobs.reduce((s, j) => s + j.priceCzk, 0);
  const sheet = XLSX.utils.aoa_to_sheet(
    [header, ...rows, [], ["Celkem", null, null, null, null, null, null, null, total]],
    {
      cellDates: true,
      // "/" is the locale date separator in Excel (shown as "." in Czech).
      dateNF: "d/m/yyyy",
    },
  );
  const sumRow = rows.length + 3;
  sheet[`I${sumRow}`] = { t: "n", v: total, f: `SUM(I2:I${rows.length + 1})` };
  const prices = XLSX.utils.aoa_to_sheet([
    ["Služba", "Cena od", "Cena do"],
    ["Přezutí", 800, 1_600],
    ["Uskladnění kol", 1_000, 1_500],
    ["Servis klimatizace", 1_500, 2_500],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Zakázky");
  XLSX.utils.book_append_sheet(workbook, prices, "Ceník");
  workbook.Props = { Title: "Export zakázek", Author: "Fixture", CreatedDate: new Date(HISTORY_END) };
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  return {
    bytes,
    manifest: {
      file: "horak-export.xlsx",
      sheets: ["Zakázky", "Ceník"],
      dataSheet: "Zakázky",
      header,
      dataRows: jobs.length,
      blankRowBeforeSummary: true,
      summaryRow: { label: "Celkem", sheetRow: sumRow, totalPriceCzk: total },
      customers: new Set(jobs.map((j) => j.customerNo)).size,
      fixedLinePhones: new Set(jobs.filter((j) => j.fixedLine).map((j) => j.customerNo)).size,
      numericPhoneCells: numericPhones,
      nameColumn: "surname first",
    },
  };
}

// ---------- 3. UTF-8: duplicates and malformed phones ----------

const MALFORMED_PHONES = [
  { value: "12345", reason: "too_short" },
  { value: "777 12 34", reason: "too_short" },
  { value: "+421 905 123 456", reason: "foreign" },
  { value: "neuvedeno", reason: "not_a_number" },
  { value: "777 123 456 789", reason: "too_long" },
  { value: "+420 123 456 789", reason: "invalid_prefix" },
] as const;

function duplicatesCsv() {
  const r = prng(SEED + 3);
  const jobs = buildJobs(r, {
    customers: 60,
    regionLetter: "J",
    fixedPrefixes: ["567"],
    fixedShare: 0.1,
    missingVehicleShare: 0.3,
    tyreHeavy: false,
    customerNoPrefix: "N",
  });
  const header = ["id", "jmeno", "prijmeni", "telefon", "email", "spz", "znacka", "model", "datum", "prace"];
  const row = (j: Job, phone: string | null) => [
    j.customerNo,
    j.firstName,
    j.lastName,
    phone ?? "",
    j.email ?? "",
    j.plate ?? "",
    j.brand ?? "",
    j.model ?? "",
    `${j.date.getUTCDate()}.${j.date.getUTCMonth() + 1}.${j.date.getUTCFullYear()}`,
    j.work,
  ];
  const data = jobs.map((j) => row(j, j.phone ? phoneText(r, j.phone) : null));

  // Malformed phones replace the phone of chosen rows.
  const malformed: { row: number; value: string; reason: string }[] = [];
  MALFORMED_PHONES.forEach((m, k) => {
    const index = 5 + k * 9;
    data[index][3] = m.value;
    malformed.push({ row: index + 1, value: m.value, reason: m.reason });
  });

  // Exact duplicate rows appended after their originals' block, plus an invalid date.
  const duplicateOf = [2, 10, 11, 30, 31, 47];
  const duplicates: { row: number; duplicateOfRow: number }[] = [];
  for (const original of duplicateOf) {
    data.push([...data[original - 1]]);
    duplicates.push({ row: data.length, duplicateOfRow: original });
  }
  const invalidDateRow = 20;
  data[invalidDateRow - 1][8] = "31.2.2024";

  const text =
    "\ufeff" + [header, ...data].map((cells) => cells.map((c) => csvField(c, ",")).join(",")).join("\n") + "\n";
  return {
    bytes: Buffer.from(text, "utf8"),
    manifest: {
      file: "nadrazi-duplicates-utf8.csv",
      encoding: "utf-8",
      bom: true,
      delimiter: ",",
      lineEnding: "LF",
      dateFormat: "d.m.yyyy",
      header,
      dataRows: data.length,
      customers: new Set(jobs.map((j) => j.customerNo)).size,
      rowsWithoutVehicle: data.filter((cells) => cells[5] === "").length,
      jobValues: false,
      exactDuplicateRows: duplicates,
      malformedPhones: malformed,
      invalidDates: [{ row: invalidDateRow, value: "31.2.2024" }],
    },
  };
}

// ---------- 4. Broken files ----------

function brokenCsv() {
  const text = [
    "Jméno;Příjmení;Telefon;Datum",
    "Jan;Novák;777 123 456;01.02.2025",
    "Eva;Svobodová;602 456 789;15.03.2025;navíc;sloupce",
    'Petr;"Dvořák;603 111 222;20.04.2025',
    "Karel;Veselý;604 222 333;05.05.2025",
    "Lenka;Černá",
  ].join("\r\n");
  return {
    bytes: iconv.encode(text, "win1250"),
    manifest: {
      file: "broken.csv",
      encoding: "windows-1250",
      delimiter: ";",
      problems: ["ragged_row:2", "unclosed_quote:3", "truncated_last_row:5"],
    },
  };
}

export interface FixtureFile {
  name: string;
  bytes: Buffer;
}

export function buildFixtures(): { files: FixtureFile[]; manifest: Record<string, unknown> } {
  const cp1250 = windows1250Csv();
  const xlsx = twoSheetXlsx();
  const dupes = duplicatesCsv();
  const broken = brokenCsv();
  // A real XLSX cut off mid-archive: the zip directory is missing.
  const truncated = { name: "truncated.xlsx", bytes: xlsx.bytes.subarray(0, 600) };
  const files: FixtureFile[] = [
    { name: cp1250.manifest.file, bytes: cp1250.bytes },
    { name: xlsx.manifest.file, bytes: xlsx.bytes },
    { name: dupes.manifest.file, bytes: dupes.bytes },
    { name: broken.manifest.file, bytes: broken.bytes },
    truncated,
  ];
  const manifest = {
    generatedBy: "pnpm db:fixtures (supabase/seed/fixture-files.ts)",
    rowNumbers: "1-based data rows, header excluded",
    files: [
      cp1250.manifest,
      xlsx.manifest,
      dupes.manifest,
      broken.manifest,
      { file: truncated.name, problems: ["invalid_zip"] },
    ],
  };
  return { files, manifest };
}
