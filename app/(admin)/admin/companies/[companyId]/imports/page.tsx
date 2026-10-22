import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ImportUploadForm } from "@/components/imports/import-client";
import { ImportStatusBadge } from "@/components/imports/import-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePageContext } from "@/lib/auth/context";
import { getCompanyRecord } from "@/lib/db/supabase/companies";
import { listImports } from "@/lib/db/supabase/imports";
import { formatDate, formatTime } from "@/lib/domain/dates";
import { formatInt } from "@/lib/domain/money";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("imports");
  return { title: t("title") };
}

/** Import history and upload (spec §11 steps 1 and 8). Real data only. */
export default async function ImportsPage(props: PageProps<"/admin/companies/[companyId]/imports">) {
  const { companyId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  await requirePageContext({ permission: "imports.run", companyId }, `/admin/companies/${companyId}/imports`);
  const company = await getCompanyRecord(companyId);
  if (!company) notFound();
  const imports = await listImports(companyId);
  const t = await getTranslations("imports");
  const base = `/admin/companies/${companyId}/imports`;

  return (
    <div className="space-y-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t("upload.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[13px] text-muted">{t("description")}</p>
          {company.dpa_signed_at ? (
            <ImportUploadForm
              companyId={companyId}
              supabaseUrl={env.NEXT_PUBLIC_SUPABASE_URL!}
              supabaseAnonKey={env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}
            />
          ) : (
            <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn" data-testid="import-dpa-missing">
              {t("dpaMissing")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {imports.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t("columns.date")}</TH>
                <TH>{t("columns.file")}</TH>
                <TH>{t("columns.type")}</TH>
                <TH>{t("columns.user")}</TH>
                <TH>{t("columns.result")}</TH>
                <TH>{t("columns.status")}</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {imports.map((i) => {
                const counts = i.counts as Record<string, number> & { committed?: Record<string, number> };
                const problems = ["invalid", "warning", "duplicate"].some((k) => (counts[k] ?? 0) > 0);
                return (
                  <TR key={i.id}>
                    <TD className="tnum whitespace-nowrap text-ink-2">
                      {formatDate(i.created_at)} {formatTime(i.created_at)}
                    </TD>
                    <TD className="max-w-56 truncate">
                      <Link href={`${base}/${i.id}`} className="font-medium text-ink hover:underline">
                        {i.file_name}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap text-ink-2">{t(`types.${i.type as "visits" | "customers"}`)}</TD>
                    <TD className="whitespace-nowrap text-ink-2">{i.createdByName ?? "—"}</TD>
                    <TD className="tnum whitespace-nowrap text-[13px] text-ink-2">
                      {counts.committed
                        ? t("resultSummary", {
                            rows: formatInt(counts.total ?? 0),
                            created: formatInt(counts.committed.customers_created ?? 0),
                            updated: formatInt(counts.committed.customers_updated ?? 0),
                          })
                        : counts.total
                          ? t("rowsSummary", { rows: formatInt(counts.total) })
                          : "—"}
                    </TD>
                    <TD>
                      <ImportStatusBadge status={i.status} />
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      {problems && (
                        <a
                          href={`${base}/${i.id}/errors`}
                          className="text-[13px] font-medium text-accent hover:underline"
                        >
                          {t("downloadErrors")}
                        </a>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}
