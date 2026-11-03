/**
 * Normalised form of a free-text service label from a garage export
 * ("SERVIS + olej", "Přezutí  kol"), used as the key of
 * service_category_mappings.raw_value_norm (spec §18): lower case, no
 * diacritics, single spaces.
 */
export function normalizeServiceLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical service categories (spec §11), the order used in pickers. */
export const SERVICE_CATEGORIES = [
  "regular_service",
  "oil_change",
  "tyre_change",
  "tyre_storage",
  "ac_service",
  "brakes",
  "diagnostics",
  "stk",
  "repair_other",
] as const;
