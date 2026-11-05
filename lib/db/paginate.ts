/**
 * Reads every row of a query page by page. The Supabase API returns at most
 * `max_rows` (1,000 by default) per request whatever range is asked for, so
 * a single `.range(0, 49_999)` silently stops at 1,000. The caller's query
 * must have a stable order.
 */
export const API_PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Page<T>,
  opts: { pageSize?: number; maxRows?: number; label?: string } = {},
): Promise<T[]> {
  const size = opts.pageSize ?? API_PAGE;
  const max = opts.maxRows ?? 200_000;
  const rows: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await fetchPage(from, from + size - 1);
    if (error) throw new Error(`${opts.label ?? "query"} failed: ${error.code ?? error.message ?? "unknown"}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < size) return rows;
  }
  throw new Error(`${opts.label ?? "query"} returned more than ${max} rows`);
}
