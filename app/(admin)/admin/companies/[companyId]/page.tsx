import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AttentionRequired } from "@/components/admin/attention-required";
import { RealCompanyProfile } from "@/components/admin/real-company";
import { KpiCard } from "@/components/common/kpi-card";
import { LifecycleBreakdown } from "@/components/common/lifecycle-breakdown";
import { OpportunityCard } from "@/components/common/opportunity-card";
import { CampaignStatusBadge } from "@/components/common/badges";
import { SectionTitle } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageContext } from "@/lib/auth/context";
import { getCompanyBasics, getCompanyOverview } from "@/lib/db/queries";
import { getCompanyDetail } from "@/lib/db/supabase/companies";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK, formatInt, formatROI } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { env } from "@/lib/env";

export async function generateMetadata(props: PageProps<"/admin/companies/[companyId]">): Promise<Metadata> {
  const { companyId } = await props.params;
  if (env.DATA_SOURCE === "supabase") return { title: (await getCompanyDetail(companyId))?.name };
  return { title: getCompanyBasics(companyId)?.company.name };
}

export default async function CompanyOverviewPage(props: PageProps<"/admin/companies/[companyId]">) {
  const { companyId } = await props.params;
  if (env.DATA_SOURCE === "supabase") {
    await requirePageContext({ permission: "admin.access" }, `/admin/companies/${companyId}`);
    const company = await getCompanyDetail(companyId);
    if (!company) notFound();
    return <RealCompanyProfile company={company} />;
  }
  const data = getCompanyOverview(companyId);
  if (!data) notFound();
  const t = await getTranslations("company.overview");
  const tKpi = await getTranslations("kpi");
  const tOpp = await getTranslations("opportunity");
  const tCampaigns = await getTranslations("campaigns");
  const base = `/admin/companies/${companyId}`;
  const c = data.company;
  const alerts = data.alerts.map((a) => ({
    ...a,
    companyName: c.name,
    campaignName: a.campaignId
      ? (data.campaigns.find((r) => r.campaign.id === a.campaignId)?.campaign.name ?? null)
      : null,
  }));

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>{t("opportunitiesTitle")}</SectionTitle>
        <p className="-mt-2 mb-4 text-[13px] text-muted">{t("opportunitiesSubtitle")}</p>
        {data.opportunities.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {data.opportunities.map((o, i) => (
              <OpportunityCard
                key={o.presetKey}
                opportunity={o}
                conversionRate={c.settings.expected_conversion_rate}
                recommended={i === 0}
                href={`${base}/campaigns/new?preset=${o.presetKey}`}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
            {tOpp("empty")}
          </p>
        )}
      </section>

      <section>
        <SectionTitle>{t("kpisTitle")}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <KpiCard label={tKpi("revenue")} value={formatCZK(data.kpis.recoveredRevenueMinor)} accent demo />
          <KpiCard label={tKpi("reactivated")} value={formatInt(data.kpis.reactivatedCustomers)} />
          <KpiCard label={tKpi("bookings")} value={formatInt(data.kpis.bookings)} />
          <KpiCard label={tKpi("messages")} value={formatInt(data.kpis.messagesSent)} />
          <KpiCard label={tKpi("roi")} value={formatROI(data.kpis.roi)} accent />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionTitle
            action={
              <Link href={`${base}/campaigns`} className="text-[13px] font-medium text-accent hover:underline">
                {t("allCampaigns")}
              </Link>
            }
          >
            {t("recentCampaigns")}
          </SectionTitle>
          <Card>
            {data.campaigns.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">{tCampaigns("empty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.campaigns.map((r) => (
                  <li key={r.campaign.id}>
                    <Link
                      href={`${base}/campaigns/${r.campaign.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-subtle/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{r.campaign.name}</div>
                        <div className="text-[12px] text-muted">
                          {formatDate(r.stats.sentAt ?? r.campaign.scheduled_at ?? r.campaign.created_at)} ·{" "}
                          {formatInt(r.stats.sent)} SMS · {formatInt(r.stats.booked)}{" "}
                          {tCampaigns("columns.bookings").toLowerCase()}
                        </div>
                      </div>
                      <div className="tnum hidden text-sm font-medium text-accent sm:block">
                        {formatCZK(r.stats.revenueMinor)}
                      </div>
                      <CampaignStatusBadge status={r.campaign.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="mt-8">
            <SectionTitle>{t("lifecycleTitle")}</SectionTitle>
            <Card>
              <CardContent>
                <LifecycleBreakdown counts={data.statusCounts} />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-8 lg:col-span-2">
          <div>
            <SectionTitle>{t("alerts")}</SectionTitle>
            {alerts.length ? (
              <AttentionRequired alerts={alerts} now={data.now} showCompany={false} />
            ) : (
              <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">{t("noAlerts")}</p>
            )}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("profile")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">{t("fields.ico")}</dt>
                <dd className="tnum">{c.ico}</dd>
                <dt className="text-muted">{t("fields.address")}</dt>
                <dd>
                  {c.address_line}, {c.postal_code} {c.city}
                </dd>
                <dt className="text-muted">{t("fields.contact")}</dt>
                <dd>{c.contact_person}</dd>
                <dt className="text-muted">{t("fields.phone")}</dt>
                <dd className="tnum">{formatPhone(c.phone)}</dd>
                <dt className="text-muted">{t("fields.email")}</dt>
                <dd className="break-all">{c.email}</dd>
                <dt className="text-muted">{t("fields.avgJob")}</dt>
                <dd className="tnum">{formatCZK(c.average_job_value_minor)}</dd>
                <dt className="text-muted">{t("fields.sender")}</dt>
                <dd className="font-mono text-[13px]">{c.default_sender_name}</dd>
                <dt className="text-muted">{t("fields.approval")}</dt>
                <dd>{c.requires_client_approval ? t("fields.approvalClient") : t("fields.approvalOperator")}</dd>
                <dt className="text-muted">{t("fields.dpa")}</dt>
                <dd>{c.dpa_signed_at ? t("fields.dpaSigned", { date: formatDate(c.dpa_signed_at) }) : "—"}</dd>
              </dl>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
