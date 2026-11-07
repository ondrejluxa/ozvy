/**
 * Screens that already read real data (DATA_SOURCE=supabase). Everything
 * else under /admin and /app still uses the in-memory demo store, so the
 * proxy shows "Tato část se připravuje" there. Later slices add patterns.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const READY: RegExp[] = [
  /^\/admin$/,
  /^\/admin\/companies(\/new)?$/,
  /^\/admin\/system(\/audit)?$/,
  /^\/admin\/campaigns$/,
  new RegExp(
    `^/admin/companies/${UUID}(/customers(/${UUID})?|/imports(/${UUID}(/errors)?)?|/campaigns(/new|/${UUID}(/edit)?)?|/segments|/services|/vocatives|/settings|/dpa|/privacy|/audit)?$`,
    "i",
  ),
  new RegExp(`^/admin/companies/${UUID}/customers/${UUID}/export$`, "i"),
  /^\/app$/,
  new RegExp(`^/app/customers(/${UUID})?$`, "i"),
  new RegExp(`^/app/campaigns(/${UUID})?$`, "i"),
  /^\/app\/results$/,
  /^\/app\/settings(\/dpa)?$/,
];

export function isRealDataReady(path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return READY.some((pattern) => pattern.test(normalized));
}

export function isUuid(value: string): boolean {
  return new RegExp(`^${UUID}$`, "i").test(value);
}
