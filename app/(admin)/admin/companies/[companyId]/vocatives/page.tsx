import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RefreshVocativesButton, VocativeReviewRow } from "@/components/admin/vocative-review";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePageContext } from "@/lib/auth/context";
import { getCompanyRecord } from "@/lib/db/supabase/companies";
import { getVocativeOverview } from "@/lib/db/supabase/vocatives";
import { resolveCompanySettings } from "@/lib/domain/company-settings";
import { formatDate } from "@/lib/domain/dates";
import { greetingFor } from "@/lib/domain/messaging/vocative";
import { formatInt } from "@/lib/domain/money";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("vocatives");
  return { title: t("title") };
}

/**
 * Vocative review (spec §0.5, §15): rules and AI suggest "pane Nováku" forms
 * per surname; the operator approves the uncertain ones. Greetings are used
 * only when the shop turned them on in settings. Real data only.
 */
export default async function VocativesPage(props: PageProps<"/admin/companies/[companyId]/vocatives">) {
  const { companyId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  await requirePageContext({ permission: "admin.access" }, `/admin/companies/${companyId}/vocatives`);
  const company = await getCompanyRecord(companyId);
  if (!company) notFound();
  const [overview, t] = await Promise.all([getVocativeOverview(companyId), getTranslations("vocatives")]);
  const enabled = resolveCompanySettings(company.settings).personalized_greeting;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <RefreshVocativesButton companyId={companyId} missing={overview.missing} />
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[13px] text-muted">{t("description")}</p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["total", overview.total],
                ["approved", overview.approved],
                ["needsReview", overview.needsReview],
                ["missing", overview.missing],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded-md border border-line px-3 py-2">
                <dt className="text-[12px] text-muted">{t(`stats.${key}`)}</dt>
                <dd className="tnum text-lg font-semibold text-ink" data-testid={`vocatives-${key}`}>
                  {formatInt(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[13px] text-ink-2" data-testid="greeting-setting">
            {enabled ? t("enabled") : t("disabled")}{" "}
            <Link href={`/admin/companies/${companyId}/settings`} className="text-accent underline">
              {t("settingsLink")}
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("reviewTitle")}</CardTitle>
          {overview.needsReview > 0 && <Badge tone="warn">{formatInt(overview.needsReview)}</Badge>}
        </CardHeader>
        <CardContent className="pb-3">
          <p className="text-[13px] text-muted">{t("reviewDescription")}</p>
        </CardContent>
        <div className="divide-y divide-line border-t border-line">
          {overview.review.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("nothingToReview")}</p>
          ) : (
            overview.review.map((v) => (
              <VocativeReviewRow
                key={v.id}
                companyId={companyId}
                id={v.id}
                surname={v.surname}
                vocative={v.vocative}
                gender={v.gender}
              />
            ))
          )}
        </div>
      </Card>

      {overview.reviewed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("reviewedTitle")}</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>{t("columns.surname")}</TH>
                <TH>{t("columns.greeting")}</TH>
                <TH>{t("columns.reviewedAt")}</TH>
              </TR>
            </THead>
            <TBody>
              {overview.reviewed.map((v) => (
                <TR key={v.id} data-testid="vocative-reviewed-row">
                  <TD className="text-ink">{v.surname}</TD>
                  <TD className="text-ink-2">{greetingFor(v)}</TD>
                  <TD className="text-ink-2">{v.reviewedAt ? formatDate(v.reviewedAt) : ""}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
