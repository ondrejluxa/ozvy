import { Loader2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  AutoRefresh,
  ImportActions,
  MappingForm,
  ReparseControls,
  RowExcludeToggle,
  StuckImportCancel,
} from "@/components/imports/import-client";
import { ImportStatusBadge } from "@/components/imports/import-status";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePageContext } from "@/lib/auth/context";
import { getImport, listImportRows, type ImportRowFilter } from "@/lib/db/supabase/imports";
import { formatDate } from "@/lib/domain/dates";
import type { ColumnMapping } from "@/lib/domain/imports/mapping";
import { isImportStuck } from "@/lib/domain/alerts/rules";
import { WORKING_STATES } from "@/lib/domain/imports/review";
import type { NormalizedRecord } from "@/lib/domain/imports/validate";
import { formatInt } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export async function generateMetadata(
  props: PageProps<"/admin/companies/[companyId]/imports/[importId]">,
): Promise<Metadata> {
  const { companyId, importId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") return {};
  return { title: (await getImport(companyId, importId))?.file_name ?? undefined };
}

const FILTERS: ImportRowFilter[] = ["all", "invalid", "warning", "duplicate", "excluded", "valid"];

/** One import, step by step (spec §11 steps 2–8). */
export default async function ImportPage(props: PageProps<"/admin/companies/[companyId]/imports/[importId]">) {
  const { companyId, importId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  const base = `/admin/companies/${companyId}/imports`;
  await requirePageContext({ permission: "imports.run", companyId }, `${base}/${importId}`);
  const imp = await getImport(companyId, importId);
  if (!imp) notFound();
  const t = await getTranslations("imports");
  const counts = imp.counts as Record<string, number> & {
    committed?: Record<string, number>;
    template_applied?: boolean;
  };
  const working = (WORKING_STATES as readonly string[]).includes(imp.status);
  // No progress for 30 minutes: the job died (alert import_stuck, ADR-018).
  const stuck = isImportStuck(imp.status, new Date(imp.updated_at), new Date());
  const resumable = imp.status === "failed" && Boolean((imp.progress as { batches_done?: number })?.batches_done);
  const committable = Math.max(0, (counts.valid ?? 0) + (counts.warning ?? 0) - (counts.ambiguous ?? 0));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: base, label: t("title") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="break-all">{imp.file_name}</span> <ImportStatusBadge status={imp.status} />
          </span>
        }
        description={`${t(`types.${imp.type as "visits"}`)} · ${formatDate(imp.created_at)}`}
        actions={
          <ImportActions
            companyId={companyId}
            importId={importId}
            status={imp.status}
            committable={committable}
            resumable={resumable}
          />
        }
      />

      {working && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-ink-2" data-testid="import-working">
            <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
            {t(`statuses.${imp.status as "parsing"}`)} · {t("working")}
            <AutoRefresh />
          </CardContent>
          {stuck && (
            <CardContent
              className="flex flex-wrap items-center gap-3 border-t border-line py-4 text-[13px] text-warn"
              role="status"
            >
              <span className="min-w-0 flex-1">{imp.status === "committing" ? t("stuckCommit") : t("stuck")}</span>
              {imp.status !== "committing" && <StuckImportCancel companyId={companyId} importId={importId} />}
            </CardContent>
          )}
        </Card>
      )}

      {imp.status === "failed" && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger" data-testid="import-error">
          {t(`failures.${(imp.error ?? "parse_failed") as "parse_failed"}`)}
        </p>
      )}

      {imp.status === "mapping" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("mapping.preview")}</CardTitle>
              <ReparseControls
                companyId={companyId}
                importId={importId}
                encoding={imp.encoding}
                sheet={imp.sheet}
                sheetNames={(imp.sheet_names as string[]) ?? []}
              />
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <THead>
                  <TR>
                    {((imp.header as string[]) ?? []).map((h, i) => (
                      <TH key={i}>{h}</TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {((imp.preview as string[][]) ?? []).map((row, r) => (
                    <TR key={r}>
                      {row.map((cell, c) => (
                        <TD key={c} className="whitespace-nowrap text-ink-2">
                          {cell}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("mapping.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-[13px] text-muted">
                {counts.template_applied ? t("mapping.templateApplied") : t("mapping.description")}
              </p>
              <MappingForm
                companyId={companyId}
                importId={importId}
                header={(imp.header as string[]) ?? []}
                mapping={(imp.mapping ?? {}) as ColumnMapping}
                legalBasis={imp.legal_basis_declared}
              />
            </CardContent>
          </Card>
        </>
      )}

      {imp.status === "needs_review" && (
        <Review
          companyId={companyId}
          importId={importId}
          counts={counts}
          mapping={(imp.mapping ?? {}) as ColumnMapping}
          searchParams={await props.searchParams}
        />
      )}

      {imp.status === "completed" && counts.committed && (
        <Card>
          <CardHeader>
            <CardTitle>{t("done.title")}</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/companies/${companyId}/customers`}>{t("done.showCustomers")}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3" data-testid="import-result">
              {(
                [
                  ["customersCreated", counts.committed.customers_created],
                  ["customersUpdated", counts.committed.customers_updated],
                  ["vehiclesCreated", counts.committed.vehicles_created],
                  ["visitsCreated", counts.committed.visits_created],
                  ["visitsUpdated", counts.committed.visits_updated],
                  ["skipped", counts.skipped],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-[12px] text-muted">{t(`done.${key}`)}</dt>
                  <dd className="tnum text-lg font-semibold text-ink" data-testid={`result-${key}`}>
                    {formatInt(value ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Review({
  companyId,
  importId,
  counts,
  mapping,
  searchParams,
}: {
  companyId: string;
  importId: string;
  counts: Record<string, number>;
  mapping: ColumnMapping;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations("imports");
  const filterParam = String(searchParams.filter ?? "all");
  const filter = (FILTERS as string[]).includes(filterParam) ? (filterParam as ImportRowFilter) : "all";
  const page = Math.max(1, Number(searchParams.page) || 1);
  const { rows, pages } = await listImportRows(companyId, importId, filter, page);
  const base = `/admin/companies/${companyId}/imports/${importId}`;
  const href = (f: ImportRowFilter, p = 1) => `${base}?filter=${f}${p > 1 ? `&page=${p}` : ""}`;
  const problems = (counts.invalid ?? 0) + (counts.warning ?? 0) + (counts.duplicate ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("review.title")}</CardTitle>
        {problems > 0 && (
          <a href={`${base}/errors`} className="text-[13px] font-medium text-accent hover:underline">
            {t("downloadErrors")}
          </a>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-[13px] text-muted">{t("review.description")}</p>
        <nav className="flex flex-wrap gap-2" aria-label={t("review.title")} data-testid="import-counts">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={href(f)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[13px]",
                f === filter ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:bg-subtle",
              )}
            >
              {t(`review.${f}`)}{" "}
              <span className="tnum font-semibold">
                {formatInt(f === "all" ? (counts.total ?? 0) : (counts[f] ?? 0))}
              </span>
            </Link>
          ))}
        </nav>
        {(counts.matched ?? 0) > 0 && (
          <p className="text-[13px] text-ink-2">{t("review.matched", { count: counts.matched })}</p>
        )}
        {(counts.ambiguous ?? 0) > 0 && (
          <p className="text-[13px] text-warn">{t("review.ambiguous", { count: counts.ambiguous })}</p>
        )}
      </CardContent>
      <div className="border-t border-line">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">{t("review.noRows")}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t("review.row")}</TH>
                <TH>{t("review.customer")}</TH>
                <TH>{t("review.phone")}</TH>
                <TH>{t("review.date")}</TH>
                <TH>{t("review.problems")}</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const n = r.normalized as unknown as NormalizedRecord | null;
                const raw = r.raw as string[];
                // Rows that failed normalisation show the source values, so the operator sees what is wrong.
                const source = (field: keyof ColumnMapping) =>
                  mapping[field] === undefined ? "" : (raw[mapping[field]!] ?? "");
                const name = n
                  ? [n.customer.first_name, n.customer.last_name].filter(Boolean).join(" ")
                  : [source("first_name"), source("last_name"), source("full_name"), source("full_name_last_first")]
                      .filter(Boolean)
                      .join(" ");
                return (
                  <TR key={r.row_number} data-testid={`import-row-${r.row_number}`}>
                    <TD className="tnum text-ink-2">{r.row_number}</TD>
                    <TD className="max-w-56 truncate text-ink">{name || "—"}</TD>
                    <TD className="tnum whitespace-nowrap text-ink-2">
                      {n?.customer.phone_e164 ? formatPhone(n.customer.phone_e164) : source("phone") || "—"}
                    </TD>
                    <TD className="tnum whitespace-nowrap text-ink-2">
                      {n?.visit ? formatDate(n.visit.visited_at) : source("visit_date") || "—"}
                    </TD>
                    <TD className="text-[13px]">
                      {(r.issues as string[]).length === 0 ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className={r.status === "invalid" ? "text-danger" : "text-warn"}>
                          {(r.issues as string[]).map((i) => t(`issues.${i as "no_contact"}`)).join(", ")}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <RowExcludeToggle
                        companyId={companyId}
                        importId={importId}
                        rowNumber={r.row_number}
                        excluded={r.status === "excluded"}
                      />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[13px]">
            <span className="text-muted">{t("review.pagination", { page, pages })}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(filter, page - 1)}>{t("review.prev")}</Link>
                </Button>
              )}
              {page < pages && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(filter, page + 1)}>{t("review.next")}</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
