import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CampaignStatusBadge } from "@/components/common/badges";
import { KpiCard } from "@/components/common/kpi-card";
import { OpportunityCard } from "@/components/common/opportunity-card";
import { DemoTag } from "@/components/demo/demo-labels";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { SectionTitle } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireClientCompany } from "@/lib/auth/client-company";
import { getSupportView } from "@/lib/auth/context";
import { getClientDashboard } from "@/lib/db/queries";
import { env, isDemo } from "@/lib/env";
import { formatDate, formatMonthLong, formatMonthShort } from "@/lib/domain/dates";
import { formatCZK, formatInt, formatPercent, formatROI } from "@/lib/domain/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.client");
  return { title: t("overview") };
}

/** Client dashboard (spec §9): answers "how much money came back" before anything else. */
export default async function ClientDashboardPage() {
  if (env.DATA_SOURCE === "supabase") return <RealClientHome />;
  const view = await getSupportView();
  if (!view) redirect("/admin");
  const data = getClientDashboard(view.companyId);
  if (!data) redirect("/admin");
  const t = await getTranslations("client");
  const tKpi = await getTranslations("kpi");
  const tDemo = await getTranslations("demo");
  const k = data.kpis;

  const deltaText =
    data.deltaVsPrevious === null
      ? t("deltaNone")
      : t("delta", {
          value: `${data.deltaVsPrevious >= 0 ? "+" : "−"}${formatPercent(Math.abs(data.deltaVsPrevious))}`,
        });

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-line bg-surface px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex items-center gap-2 text-sm font-medium text-muted">
          {t("heroLabel")} <DemoTag />
        </div>
        <div className="tnum mt-2 text-[44px] font-semibold leading-none tracking-tight text-accent sm:text-hero">
          {formatCZK(k.recoveredRevenueMinor)}
        </div>
        <div className="mt-3 flex flex-col gap-1 text-sm sm:flex-row sm:gap-4">
          <span
            className={
              data.deltaVsPrevious !== null && data.deltaVsPrevious >= 0 ? "font-medium text-accent" : "text-ink-2"
            }
          >
            {deltaText}
          </span>
          <span className="tnum text-muted">{t("totalSince", { value: formatCZK(data.totalSinceStartMinor) })}</span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label={tKpi("reactivated")} value={formatInt(k.reactivatedCustomers)} />
        <KpiCard label={tKpi("bookings")} value={formatInt(k.bookings)} />
        <KpiCard label={tKpi("messages")} value={formatInt(k.messagesSent)} />
        <KpiCard label={tKpi("subscription")} value={formatCZK(k.subscriptionMinor)} />
        <KpiCard label={tKpi("roi")} value={formatROI(k.roi)} accent demo className="col-span-2 md:col-span-1" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("chartTitle")}</CardTitle>
          <DemoTag />
        </CardHeader>
        <CardContent>
          <RevenueChart
            labels={{ revenue: t("chartRevenue"), subscription: t("chartSubscription") }}
            data={data.series.map((p) => ({
              label: formatMonthShort(p.month),
              longLabel: formatMonthLong(p.month),
              revenue: p.revenueMinor / 100,
              subscription: p.subscriptionMinor / 100,
            }))}
          />
          {isDemo && <p className="mt-3 text-[12px] text-muted">{tDemo("chartNote")}</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("currentCampaigns")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {data.currentCampaigns.length === 0 ? (
              <p className="text-sm text-muted">{t("noCampaigns")}</p>
            ) : (
              <ul className="space-y-4">
                {data.currentCampaigns.map((r) => (
                  <li key={r.campaign.id}>
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/app/campaigns/${r.campaign.id}`}
                        className="min-w-0 truncate text-sm font-medium text-ink hover:underline"
                      >
                        {r.campaign.name}
                      </Link>
                      <CampaignStatusBadge status={r.campaign.status} />
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(3, r.windowProgress * 100)}%` }}
                      />
                    </div>
                    <p className="tnum mt-1.5 text-[12px] text-muted">
                      {r.stats.sentAt
                        ? t("campaignProgress", {
                            sent: formatInt(r.stats.sent),
                            booked: r.stats.booked,
                            revenue: formatCZK(r.stats.revenueMinor),
                          })
                        : t("awaitingSend")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("recent")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {data.recent.length === 0 ? (
              <p className="text-sm text-muted">{t("noRecent")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recent.map((r) => (
                  <li
                    key={r.conversionId}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/app/customers/${r.customerId}`}
                        className="text-sm font-medium text-ink hover:underline"
                      >
                        {r.name}
                      </Link>
                      <p className="truncate text-[12px] text-muted">
                        {r.vehicle ?? "—"} · {r.campaignName} · {formatDate(r.completedAt)}
                      </p>
                    </div>
                    <span className="tnum shrink-0 text-sm font-semibold text-accent">{formatCZK(r.revenueMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {data.opportunities.length > 0 && (
        <section>
          <SectionTitle>{t("opportunities")}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {data.opportunities.map((o, i) => (
              <OpportunityCard
                key={o.presetKey}
                opportunity={o}
                conversionRate={data.company.settings.expected_conversion_rate}
                recommended={i === 0}
                readOnly
              />
            ))}
          </div>
          <p className="mt-3 text-[12px] text-muted">{t("managedNote")}</p>
        </section>
      )}
    </div>
  );
}

/**
 * DATA_SOURCE=supabase: the shop's own home. Results appear here once the
 * first campaign has been sent (dashboards slice, spec §40.15).
 */
async function RealClientHome() {
  const { session, membership } = await requireClientCompany("/app");
  const t = await getTranslations("realData.clientHome");
  return (
    <section className="rounded-xl border border-line bg-surface px-5 py-6 sm:px-8 sm:py-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">{membership.companyName}</h1>
      <p className="mt-2 text-sm text-ink-2">{t("welcome", { name: session.fullName ?? session.email ?? "" })}</p>
      <p className="mt-1 text-sm text-muted">{t("empty")}</p>
    </section>
  );
}
