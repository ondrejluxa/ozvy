/**
 * Screens that already read real data (DATA_SOURCE=supabase). Everything
 * else under /admin and /app still uses the in-memory demo store, so the
 * proxy shows "Tato část se připravuje" there. Later slices add patterns.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const READY: RegExp[] = [
  /^\/admin$/,
  /^\/admin\/companies(\/new)?$/,
  new RegExp(`^/admin/companies/${UUID}(/customers(/${UUID})?|/settings|/dpa)?$`, "i"),
  /^\/app$/,
  new RegExp(`^/app/customers(/${UUID})?$`, "i"),
];

export function isRealDataReady(path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return READY.some((pattern) => pattern.test(normalized));
}

export function isUuid(value: string): boolean {
  return new RegExp(`^${UUID}$`, "i").test(value);
}
