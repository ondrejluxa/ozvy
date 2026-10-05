import { Search } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LifecycleBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/inputs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listCustomers, type CustomerFilters, type LastVisitBucket } from "@/lib/db/queries";
import type { LifecycleStatus, ServiceCategory } from "@/lib/db/types";
import { formatDate } from "@/lib/domain/dates";

const STATUSES: LifecycleStatus[] = ["active", "at_risk", "inactive", "reactivated", "opted_out"];
const BUCKETS: LastVisitBucket[] = ["0-6", "6-12", "12-18", "18+", "none"];
const CATEGORIES: ServiceCategory[] = [
  "regular_service",
  "oil_change",
  "tyre_change",
  "tyre_storage",
  "ac_service",
  "brakes",
  "diagnostics",
  "stk",
  "repair_other",
];

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function parseCustomerFilters(sp: Params): CustomerFilters {
  const status = one(sp.status);
  const lastVisit = one(sp.lastVisit);
  const eligibility = one(sp.eligibility);
  const category = one(sp.category);
  return {
    q: one(sp.q)?.slice(0, 80),
    status: STATUSES.includes(status as LifecycleStatus) ? (status as LifecycleStatus) : undefined,
    lastVisit: BUCKETS.includes(lastVisit as LastVisitBucket) ? (lastVisit as LastVisitBucket) : undefined,
    eligibility: eligibility === "eligible" || eligibility === "ineligible" ? eligibility : undefined,
    category: CATEGORIES.includes(category as ServiceCategory) ? (category as ServiceCategory) : undefined,
    page: Number(one(sp.page)) || 1,
  };
}

function query(filters: CustomerFilters, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, page: page > 1 ? String(page) : undefined })) {
    if (v !== undefined && v !== "" && k !== "page") p.set(k, String(v));
  }
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Searchable customer list with filters (spec §8 "Zákazníci – seznam"). Plain GET form, no client JS. */
export async function CustomerList({
  companyId,
  basePath,
  searchParams,
}: {
  companyId: string;
  basePath: string;
  searchParams: Params;
}) {
  const t = await getTranslations("customers");
  const tStatus = await getTranslations("status");
  const tCategory = await getTranslations("category");
  const filters = parseCustomerFilters(searchParams);
  const data = listCustomers(companyId, filters);
  if (!data) return null;
  const active = Boolean(filters.q || filters.status || filters.lastVisit || filters.eligibility || filters.category);

  return (
    <div className="space-y-4">
      <form method="get" action={basePath} className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={filters.q}
            placeholder={t("search")}
            aria-label={t("search")}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
          <Select
            name="status"
            defaultValue={filters.status ?? ""}
            aria-label={t("columns.status")}
            className="lg:w-40"
          >
            <option value="">{t("filters.allStatuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </Select>
          <Select
            name="lastVisit"
            defaultValue={filters.lastVisit ?? ""}
            aria-label={t("columns.lastVisit")}
            className="lg:w-52"
          >
            <option value="">{t("filters.anyTime")}</option>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>
                {t(`filters.buckets.${b}`)}
              </option>
            ))}
          </Select>
          <Select
            name="category"
            defaultValue={filters.category ?? ""}
            aria-label={t("filters.anyCategory")}
            className="lg:w-44"
          >
            <option value="">{t("filters.anyCategory")}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tCategory(c)}
              </option>
            ))}
          </Select>
          <Select
            name="eligibility"
            defaultValue={filters.eligibility ?? ""}
            aria-label={t("filters.anyEligibility")}
            className="lg:w-44"
          >
            <option value="">{t("filters.anyEligibility")}</option>
            <option value="eligible">{t("filters.eligible")}</option>
            <option value="ineligible">{t("filters.ineligible")}</option>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="default">
            {t("filters.apply")}
          </Button>
          {active && (
            <Button asChild variant="ghost">
              <Link href={basePath}>{t("filters.clear")}</Link>
            </Button>
          )}
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-5 py-2.5 text-[13px] text-muted">
          {t("total", { count: data.total })}
        </div>
        {data.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t("columns.name")}</TH>
                <TH>{t("columns.phone")}</TH>
                <TH>{t("columns.vehicle")}</TH>
                <TH>{t("columns.lastVisit")}</TH>
                <TH>{t("columns.status")}</TH>
                <TH>{t("columns.lastContacted")}</TH>
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
                  <TD className="tnum whitespace-nowrap text-ink-2">{r.phone}</TD>
                  <TD className="whitespace-nowrap">
                    {r.vehicle ? (
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
                  <TD>
                    <LifecycleBadge status={r.status} />
                  </TD>
                  <TD className="tnum whitespace-nowrap text-ink-2">
                    {r.lastContactedAt ? formatDate(r.lastContactedAt) : "—"}
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
                  <Link href={`${basePath}${query(filters, data.page - 1)}`}>{t("prev")}</Link>
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
