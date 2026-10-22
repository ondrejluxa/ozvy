/**
 * File checks and format detection for imports (spec §11 steps 1–2, §22).
 * Pure functions over bytes and strings; no I/O.
 */

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 100_000;
/** Zip-bomb guard: total uncompressed size of an XLSX archive. */
export const XLSX_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export type FileKind = "csv" | "xlsx";
export type FileIssue = "empty" | "too_large" | "unsupported_type" | "macro_enabled" | "archive_too_large";

/** Size, extension and magic bytes must agree; .xlsm and other macro files are refused. */
export function checkImportFile(file: {
  name: string;
  size: number;
  bytes: Uint8Array;
}): { ok: true; kind: FileKind } | { ok: false; issue: FileIssue } {
  if (file.size === 0) return { ok: false, issue: "empty" };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, issue: "too_large" };
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  const isZip = file.bytes[0] === 0x50 && file.bytes[1] === 0x4b && file.bytes[2] === 0x03 && file.bytes[3] === 0x04;
  if (["xlsm", "xlsb", "xltm", "xls"].includes(ext))
    return { ok: false, issue: ext === "xls" ? "unsupported_type" : "macro_enabled" };
  if (ext === "xlsx") {
    if (!isZip) return { ok: false, issue: "unsupported_type" };
    const content = zipEntries(file.bytes);
    if (!content) return { ok: false, issue: "unsupported_type" };
    if (content.names.some((n) => /vbaProject\.bin$/i.test(n))) return { ok: false, issue: "macro_enabled" };
    if (content.uncompressed > XLSX_MAX_UNCOMPRESSED_BYTES) return { ok: false, issue: "archive_too_large" };
    return { ok: true, kind: "xlsx" };
  }
  if (["csv", "txt"].includes(ext)) {
    // A text file must not be a binary in disguise (zip, PDF, executables, NUL bytes).
    if (isZip || file.bytes.subarray(0, 4096).includes(0)) return { ok: false, issue: "unsupported_type" };
    return { ok: true, kind: "csv" };
  }
  return { ok: false, issue: "unsupported_type" };
}

/**
 * Reads the zip central directory: entry names and the total uncompressed
 * size, without inflating anything. Returns null for a broken archive.
 */
export function zipEntries(bytes: Uint8Array): { names: string[]; uncompressed: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory record: signature 0x06054b50, searched from the end.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  let uncompressed = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    uncompressed += view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { names, uncompressed };
}

export type TextEncodingName = "utf-8" | "utf-8-bom" | "windows-1250" | "iso-8859-2";
export const TEXT_ENCODINGS: TextEncodingName[] = ["utf-8", "utf-8-bom", "windows-1250", "iso-8859-2"];

/**
 * UTF-8 (with or without BOM) when the bytes decode cleanly; otherwise the
 * Czech single-byte code page whose letter positions the text uses more:
 * Š Ť Ž š ť ž sit at 0x8A–0x9E in Windows-1250 and at 0xA9–0xBE in ISO-8859-2.
 */
export function detectEncoding(bytes: Uint8Array): TextEncodingName {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8-bom";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    // not UTF-8
  }
  const cp1250 = new Set([0x8a, 0x8d, 0x8e, 0x9a, 0x9d, 0x9e]);
  const iso = new Set([0xa9, 0xab, 0xae, 0xb9, 0xbb, 0xbe]);
  let a = 0;
  let b = 0;
  for (const byte of bytes) {
    if (cp1250.has(byte)) a++;
    else if (iso.has(byte)) b++;
  }
  return b > a ? "iso-8859-2" : "windows-1250";
}

export type Delimiter = ";" | "," | "\t";
export const DELIMITERS: Delimiter[] = [";", ",", "\t"];

/** Counts a delimiter outside double quotes on one line. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) count++;
  }
  return count;
}

/**
 * The delimiter that splits the first lines into the most consistent number
 * of columns (more than one). Ties prefer ";", the Czech Excel default.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 30);
  let best: Delimiter = ";";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [mode, hits] = [...freq.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0] ?? [0, 0];
    const score = mode > 0 ? hits * 1000 + mode : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

const filled = (row: string[]) => row.filter((c) => c.trim() !== "");
const numeric = (s: string) => /^[\d\s.,+\-/:%]+(\s?(Kč|CZK))?$/i.test(s.trim());

/** First row among the first 10 that looks like a header: at least two cells, mostly text. */
export function detectHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = filled(rows[i]);
    if (cells.length >= 2 && cells.filter((c) => !numeric(c)).length >= Math.ceil(cells.length * 0.75)) return i;
  }
  return 0;
}

const SUMMARY = /^(celkem|součet|soucet|suma|total|mezisoučet|subtotal)\b/i;

/** Empty rows and totals ("Celkem", "Součet") are skipped, not imported. */
export function isSkippableRow(row: string[]): boolean {
  const cells = filled(row);
  if (cells.length === 0) return true;
  return SUMMARY.test(cells[0].trim());
}
