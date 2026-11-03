import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RecomputeButton, ServiceCategorySelect } from "@/components/admin/lifecycle-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePageContext } from "@/lib/auth/context";
import { getCompanyRecord } from "@/lib/db/supabase/companies";
import { createSupabaseServerClient } from "@/lib/db/supabase/server-client";
import { formatDate, formatTime } from "@/lib/domain/dates";
import { formatInt } from "@/lib/domain/money";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("services");
  return { title: t("title") };
}

/**
 * Service category mapping (spec §11, §6 F1 step 4): every work description
 * from the shop's visits, its category, and whether the operator fixed it or
 * the keyword rules chose it. Real data only.
 */
export default async function ServicesPage(props: PageProps<"/admin/companies/[companyId]/services">) {
  const { companyId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  await requirePageContext({ permission: "admin.access" }, `/admin/companies/${companyId}/services`);
  const company = await getCompanyRecord(companyId);
  if (!company) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: labels, error } = await supabase.rpc("list_service_labels", { p_company_id: companyId });
  if (error) throw new Error(`list_service_labels failed: ${error.code}`);
  const t = await getTranslations("services");
  const tLifecycle = await getTranslations("lifecycle");
  const unmapped = (labels ?? []).filter((l) => !l.mapped).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{tLifecycle("title")}</CardTitle>
          <RecomputeButton companyId={companyId} />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-2" data-testid="lifecycle-computed">
            {company.lifecycle_computed_at
              ? tLifecycle("computedAt", {
                  date: formatDate(company.lifecycle_computed_at),
                  time: formatTime(company.lifecycle_computed_at),
                })
              : tLifecycle("never")}
          </p>
          <p className="mt-1 text-[13px] text-muted">{tLifecycle("description")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          {unmapped > 0 && <Badge tone="warn">{t("unmapped", { count: unmapped })}</Badge>}
        </CardHeader>
        <CardContent className="space-y-1 pb-3">
          <p className="text-[13px] text-muted">{t("description")}</p>
        </CardContent>
        <div className="border-t border-line">
          {(labels ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("empty")}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t("columns.label")}</TH>
                  <TH className="text-right">{t("columns.visits")}</TH>
                  <TH>{t("columns.category")}</TH>
                  <TH>{t("columns.source")}</TH>
                </TR>
              </THead>
              <TBody>
                {(labels ?? []).map((l) => (
                  <TR key={l.label_norm} data-testid="service-label">
                    <TD className="text-ink">{l.example}</TD>
                    <TD className="tnum text-right text-ink-2">{formatInt(Number(l.visits))}</TD>
                    <TD>
                      <ServiceCategorySelect
                        companyId={companyId}
                        label={l.label_norm}
                        example={l.example}
                        category={l.category}
                      />
                    </TD>
                    <TD>
                      <Badge tone={l.mapped ? "accent" : "neutral"}>{l.mapped ? t("mapped") : t("automatic")}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
