import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LifecycleBadge } from "@/components/common/badges";
import { CustomerFilterForm, parseCustomerFilters, query } from "@/components/customers/customer-list";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listCustomerPage } from "@/lib/db/supabase/customers";
import { formatDate } from "@/lib/domain/dates";
import { formatInt } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";

type Params = Record<string, string | string[] | undefined>;

/**
 * Customer list on real data (DATA_SOURCE=supabase, spec §8 "Zákazníci –
 * seznam"): one search box (name, phone, plate), filters, 50 per page.
 * "Naposledy osloven" joins when messages exist (slice 12).
 */
export async function RealCustomerList({
  companyId,
  basePath,
  searchParams,
}: {
  companyId: string;
  basePath: string;
  searchParams: Params;
}) {
  const t = await getTranslations("customers");
  const filters = parseCustomerFilters(searchParams);
  const data = await listCustomerPage(companyId, filters);
  const filtered = Boolean(filters.q || filters.status || filters.lastVisit || filters.eligibility || filters.category);

  return (
    <div className="space-y-4">
      <CustomerFilterForm basePath={basePath} filters={filters} />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-5 py-2.5 text-[13px] text-muted" data-testid="customer-total">
          {t("total", { count: data.total })}
        </div>
        {data.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{filtered ? t("empty") : t("emptyCompany")}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t("columns.name")}</TH>
                <TH>{t("columns.phone")}</TH>
                <TH>{t("columns.vehicle")}</TH>
                <TH>{t("columns.lastVisit")}</TH>
                <TH className="text-right">{t("columns.visits")}</TH>
                <TH>{t("columns.status")}</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.id} className="hover:bg-subtle/60">
                  <TD className="whitespace-nowrap">
                    <Link href={`${basePath}/${r.id}`} className="font-medium text-ink hover:underline">
                      {r.name}
                    </Link>
                  </TD>
                  <TD className="tnum whitespace-nowrap text-ink-2">{r.phone ? formatPhone(r.phone) : "—"}</TD>
                  <TD className="whitespace-nowrap">
                    {r.vehicle || r.plate ? (
                      <>
                        <span className="text-ink">{r.vehicle}</span>{" "}
                        <span className="font-mono text-[12px] text-muted">{r.plate}</span>
                        {r.extraVehicles > 0 && (
                          <span className="ml-1.5 text-[12px] text-muted">
                            {t("moreVehicles", { count: r.extraVehicles })}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-faint">{t("noVehicle")}</span>
                    )}
                  </TD>
                  <TD className="tnum whitespace-nowrap text-ink-2">
                    {r.lastVisitAt ? formatDate(r.lastVisitAt) : "—"}
                  </TD>
                  <TD className="tnum text-right text-ink-2">{formatInt(r.visitCount)}</TD>
                  <TD>
                    <LifecycleBadge status={r.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[13px]">
            <span className="text-muted">{t("pagination", { page: data.page, pages: data.pages })}</span>
            <div className="flex gap-2">
              {data.page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`${basePath}${query(filters, Math.min(data.page, data.pages) - 1)}`}>{t("prev")}</Link>
                </Button>
              )}
              {data.page < data.pages && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`${basePath}${query(filters, data.page + 1)}`}>{t("next")}</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
