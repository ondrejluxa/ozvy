import iconv from "iconv-lite";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  IMPORT_MAX_ROWS,
  detectDelimiter,
  detectEncoding,
  detectHeaderRow,
  isSkippableRow,
  type Delimiter,
  type FileKind,
  type TextEncodingName,
} from "./detect";

/**
 * Turns an uploaded file into a header and string rows (spec §11 step 2).
 * Every cell is a string: formulas are never evaluated (cached values only),
 * dates in XLSX stay Excel serial numbers and are interpreted after mapping.
 */

export interface ParsedRow {
  /** Row number in the source file (1-based, as the shop sees it in Excel). */
  sourceRow: number;
  cells: string[];
}

export interface ParsedFile {
  kind: FileKind;
  encoding: TextEncodingName | null;
  delimiter: Delimiter | null;
  sheetNames: string[];
  sheet: string | null;
  header: string[];
  rows: ParsedRow[];
  /** Rows with a different number of columns than the header (1-based source rows). */
  raggedRows: number[];
}

export type ParseFailure = "malformed_csv" | "no_data" | "too_many_rows" | "unreadable_xlsx";

export class ImportParseError extends Error {
  constructor(public code: ParseFailure) {
    super(code);
  }
}

export function decodeText(bytes: Uint8Array, encoding: TextEncodingName): string {
  if (encoding === "windows-1250") return iconv.decode(Buffer.from(bytes), "win1250");
  if (encoding === "iso-8859-2") return iconv.decode(Buffer.from(bytes), "iso-8859-2");
  return new TextDecoder("utf-8").decode(bytes).replace(/^\ufeff/, "");
}

function finish(
  kind: FileKind,
  table: string[][],
  meta: Pick<ParsedFile, "encoding" | "delimiter" | "sheetNames" | "sheet">,
): ParsedFile {
  const headerIndex = detectHeaderRow(table);
  const header = (table[headerIndex] ?? []).map((h) => h.trim());
  if (header.filter(Boolean).length === 0) throw new ImportParseError("no_data");
  const rows: ParsedRow[] = [];
  const raggedRows: number[] = [];
  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i].map((c) => c.trim());
    if (isSkippableRow(cells)) continue;
    const sourceRow = i + 1;
    if (cells.length > header.length && cells.slice(header.length).some((c) => c !== "")) raggedRows.push(sourceRow);
    else if (kind === "csv" && cells.length < header.length) raggedRows.push(sourceRow);
    rows.push({ sourceRow, cells: header.map((_, k) => cells[k] ?? "") });
    if (rows.length > IMPORT_MAX_ROWS) throw new ImportParseError("too_many_rows");
  }
  if (rows.length === 0) throw new ImportParseError("no_data");
  return { kind, header, rows, raggedRows, ...meta };
}

export function parseCsv(bytes: Uint8Array, options: { encoding?: TextEncodingName } = {}): ParsedFile {
  const encoding = options.encoding ?? detectEncoding(bytes);
  const text = decodeText(bytes, encoding);
  const delimiter = detectDelimiter(text);
  const result = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  // An unclosed quote swallows the rest of the file: refuse rather than half-import.
  if (result.errors.some((e) => e.type === "Quotes")) throw new ImportParseError("malformed_csv");
  return finish("csv", result.data, { encoding, delimiter, sheetNames: [], sheet: null });
}

export function parseXlsx(bytes: Uint8Array, options: { sheet?: string } = {}): ParsedFile {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellFormula: false,
      cellHTML: false,
      cellText: false,
      cellDates: false,
      sheetRows: IMPORT_MAX_ROWS + 20,
    });
  } catch {
    throw new ImportParseError("unreadable_xlsx");
  }
  const sheetNames = workbook.SheetNames;
  const sheet = options.sheet && sheetNames.includes(options.sheet) ? options.sheet : sheetNames[0];
  if (!sheet) throw new ImportParseError("no_data");
  const table = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });
  const strings = table.map((row) => row.map((v) => (v === null || v === undefined ? "" : String(v))));
  return finish("xlsx", strings, { encoding: null, delimiter: null, sheetNames, sheet });
}

export function parseImportFile(
  kind: FileKind,
  bytes: Uint8Array,
  options: { encoding?: TextEncodingName; sheet?: string } = {},
): ParsedFile {
  return kind === "xlsx" ? parseXlsx(bytes, options) : parseCsv(bytes, options);
}
