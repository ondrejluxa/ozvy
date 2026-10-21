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
