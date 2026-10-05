/** "+420777123456" → "+420 777 123 456". */
export function formatPhone(e164: string | null): string {
  if (!e164) return "—";
  const m = /^\+420(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `+420 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]/g, "")
    .toLowerCase();
}
