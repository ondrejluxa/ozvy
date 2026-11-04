/**
 * Czech vocatives for surnames (spec §0.5, §15). Rules cover the regular
 * patterns; everything else goes to an AI batch suggestion and then to the
 * operator's review list. A wrong vocative ("pane Novák", "paní Novákov")
 * looks worse than none, so anything uncertain falls back to "Dobrý den,".
 */

export type Gender = "m" | "f" | "unknown";

export interface VocativeGuess {
  vocative: string;
  gender: Gender;
  /** 0–1; below REVIEW_THRESHOLD the entry needs the operator. */
  confidence: number;
}

export interface StoredVocative {
  vocative: string;
  gender: Gender;
  confidence: number;
  reviewedAt: string | null;
}

export const REVIEW_THRESHOLD = 0.9;
export const DEFAULT_GREETING = "Dobrý den,";

const LETTERS = /^\p{L}+(?:[-' ]\p{L}+)*$/u;
const SOFT = /[šžčřcjťďň]$/u;
const VELAR = /(?:k|h|g|ch)$/u;
const HARD = /[dtnlmpbvf]$/u;

const guess = (vocative: string, gender: Gender, confidence: number): VocativeGuess => ({
  vocative,
  gender,
  confidence,
});

/** Title-cases an all-caps import value ("NOVÁK" → "Novák"); keeps mixed case. */
export function normalizeSurname(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (s !== s.toUpperCase() || s === s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[-' ])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

/**
 * Rule-based vocative for one surname, or null when no rule applies
 * (the AI batch suggests those). Double-barrelled names are left to review.
 */
export function ruleVocative(raw: string): VocativeGuess | null {
  const s = normalizeSurname(raw);
  if (!LETTERS.test(s) || /[-' ]/.test(s) || s.length < 2) return null;
  const lower = s.toLowerCase();

  // Feminine: Nováková, Černá. The vocative equals the nominative.
  if (lower.endsWith("ová")) return guess(s, "f", 0.99);
  if (/[^aeiouyáéěíóúůý]á$/u.test(lower)) return guess(s, "f", 0.95);
  // Adjectival masculine: Černý. Krejčí / Jirásková-type -í is gender-neutral.
  if (lower.endsWith("ý")) return guess(s, "m", 0.97);
  if (lower.endsWith("í")) return guess(s, "unknown", 0.6);
  // Masculine -a: Svoboda → Svobodo, Procházka → Procházko.
  if (/[^aeiouyáéěíóúůý]a$/u.test(lower) && s.length > 3) return guess(`${s.slice(0, -1)}o`, "m", 0.92);
  // -ek with a fleeting e: Hájek → Hájku, Sedláček → Sedláčku.
  if (/[^aeiouyáéěíóúůý]ek$/u.test(lower) && s.length > 4) return guess(`${s.slice(0, -2)}ku`, "m", 0.9);
  // -ec is irregular (Němec → Němče, Kadlec → Kadleci): review.
  if (lower.endsWith("ec")) return guess(`${s}i`, "m", 0.5);
  // -el often drops the e (Havel → Havle) but not always (Pospíšil, Doležel): review.
  if (/[^aeiouyáéěíóúůý]el$/u.test(lower)) return guess(`${s}e`, "m", 0.5);
  // Velars take -u: Novák → Nováku, Dvořák → Dvořáku.
  if (VELAR.test(lower)) return guess(`${s}u`, "m", 0.95);
  // Soft consonants take -i: Beneš → Beneši, Kovář → Kováři.
  if (SOFT.test(lower)) return guess(`${s}i`, "m", 0.93);
  // -r after a consonant becomes -ře (Petr-type), after a vowel -re (Kocour → Kocoure).
  if (/[^aeiouyáéěíóúůý]r$/u.test(lower)) return guess(`${s.slice(0, -1)}ře`, "m", 0.6);
  if (lower.endsWith("r")) return guess(`${s}e`, "m", 0.9);
  // Other hard consonants take -e: Zeman → Zemane, Musil → Musile, Holub → Holube.
  if (HARD.test(lower)) return guess(`${s}e`, "m", 0.9);
  // -s/-z/-x and vowel endings (Klaus, Kraus, Hrubo, Matějů) are too irregular.
  return null;
}

/** Whether a stored vocative may be used in a greeting. */
export function isVocativeApproved(v: StoredVocative): boolean {
  return v.gender !== "unknown" && (v.reviewedAt !== null || v.confidence >= REVIEW_THRESHOLD);
}

/** "Dobrý den, pane Nováku," / "Dobrý den, paní Nováková," or the safe default. */
export function greetingFor(v: StoredVocative | null | undefined): string {
  if (!v || !isVocativeApproved(v)) return DEFAULT_GREETING;
  return `Dobrý den, ${v.gender === "m" ? "pane" : "paní"} ${v.vocative},`;
}

/**
 * Sanity check for an AI-suggested vocative: letters only, shares the stem
 * and differs by at most a few letters at the end. Anything else is dropped
 * and the surname stays without a vocative.
 */
export function plausibleVocative(surname: string, vocative: string): boolean {
  const s = normalizeSurname(surname);
  const v = vocative.trim();
  if (!LETTERS.test(v) || v.length > 80) return false;
  const stem = Math.max(2, Math.min(s.length - 2, v.length - 2));
  if (s.slice(0, stem).toLowerCase() !== v.slice(0, stem).toLowerCase()) return false;
  return Math.abs(v.length - s.length) <= 2;
}
