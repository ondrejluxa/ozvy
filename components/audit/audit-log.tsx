import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/inputs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { AuditRow } from "@/lib/db/supabase/audit";
import { AUDIT_GROUPS, auditDetails, auditQuery, type AuditFilter } from "@/lib/domain/audit-filters";
import { formatDateTime } from "@/lib/domain/dates";

/**
 * Audit log screen (spec §23): filter by event group and date, 50 rows per
 * page. `simplified` is the owner's "Historie změn": no technical details.
 */
export async function AuditLog({
  rows,
  hasMore,
  filter,
  basePath,
  showShop = false,
  simplified = false,
  hiddenParams,
}: {
  rows: AuditRow[];
  hasMore: boolean;
  filter: AuditFilter;
  basePath: string;
  showShop?: boolean;
  simplified?: boolean;
  /** Extra query parameters the page needs (e.g. the settings tab). */
  hiddenParams?: Record<string, string>;
}) {
  const t = await getTranslations("auditLog");
  const tCommon = await getTranslations("common");
  const tActions = await getTranslations("auditActions");
  const label = (action: string) =>
    tActions.has(action.replace(".", "_")) ? tActions(action.replace(".", "_")) : action;
  const filtered = Boolean(filter.group || filter.from || filter.to);
  const hidden = hiddenParams ? new URLSearchParams(hiddenParams).toString() : "";
  const href = (query: string) =>
    hidden ? `${basePath}?${hidden}${query ? `&${query.slice(1)}` : ""}` : `${basePath}${query}`;

  return (
    <div className="space-y-4">
      {/* A GET form: the filter lives in the URL and works without JavaScript. */}
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3" role="search">
        {Object.entries(hiddenParams ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="audit-group">{t("filters.action")}</Label>
          <Select id="audit-group" name="akce" defaultValue={filter.group ?? ""} className="w-56">
            <option value="">{t("filters.allActions")}</option>
            {AUDIT_GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`groups.${g}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-from">{t("filters.from")}</Label>
          <Input id="audit-from" type="date" name="od" defaultValue={filter.from ?? ""} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-to">{t("filters.to")}</Label>
          <Input id="audit-to" type="date" name="do" defaultValue={filter.to ?? ""} className="w-40" />
        </div>
        <Button type="submit" size="md" variant="outline">
          {t("filters.apply")}
        </Button>
        {filtered && (
          <Link href={href("")} className="pb-2 text-[13px] text-muted underline-offset-4 hover:underline">
            {t("filters.reset")}
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <Table data-testid="audit-log">
            <THead>
              <TR>
                <TH>{t("columns.when")}</TH>
                {showShop && <TH>{t("columns.shop")}</TH>}
                <TH>{t("columns.who")}</TH>
                <TH>{t("columns.action")}</TH>
                {!simplified && <TH>{t("columns.details")}</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} data-testid="audit-row">
                  <TD className="tnum whitespace-nowrap text-ink-2">{formatDateTime(r.createdAt)}</TD>
                  {showShop && <TD className="text-ink-2">{r.companyName ?? "—"}</TD>}
                  <TD className="whitespace-nowrap">
                    <span className="text-ink">{r.actorName ?? t(`actors.${r.actorType}`)}</span>
                    {r.actorName && <span className="block text-[12px] text-muted">{t(`actors.${r.actorType}`)}</span>}
                  </TD>
                  <TD>
                    <span className="text-ink">{label(r.action)}</span>
                    {!simplified && <span className="block font-mono text-[11px] text-muted">{r.action}</span>}
                  </TD>
                  {!simplified && (
                    <TD className="max-w-md break-words text-[12px] text-ink-2">{auditDetails(r.metadata) || "—"}</TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {(filter.page > 1 || hasMore) && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label={t("title")}>
          {filter.page > 1 ? (
            <Link href={href(auditQuery(filter, filter.page - 1))} className="text-accent hover:underline">
              ← {tCommon("previous")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">{tCommon("page", { page: filter.page })}</span>
          {hasMore ? (
            <Link href={href(auditQuery(filter, filter.page + 1))} className="text-accent hover:underline">
              {tCommon("next")} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
