/**
 * "Odstranit diakritiku": maps Czech (and other Latin) accented letters to
 * their base letters so the message fits GSM-7. Also normalises typographic
 * punctuation that is not in the GSM-7 alphabet.
 */
const PUNCTUATION: Record<string, string> = {
  "–": "-",
  "—": "-",
  "„": '"',
  "“": '"',
  "”": '"',
  "‚": "'",
  "‘": "'",
  "’": "'",
  "…": "...",
  "\u00a0": " ",
};

export function stripDiacritics(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—„“”‚‘’…\u00a0]/g, (ch) => PUNCTUATION[ch] ?? ch);
}
