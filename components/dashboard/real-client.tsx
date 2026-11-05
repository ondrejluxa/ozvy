import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CampaignStatusBadge } from "@/components/common/badges";
import { KpiCard } from "@/components/common/kpi-card";
import { OpportunityCard } from "@/components/common/opportunity-card";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { RealClientDashboard, RealResults } from "@/lib/db/supabase/dashboard";
import type { CampaignStatus } from "@/lib/db/types";
import { roi } from "@/lib/domain/attribution/kpis";
import { formatDate, formatMonthLong, formatMonthShort } from "@/lib/domain/dates";
import { formatCZK, formatInt, formatPercent, formatROI } from "@/lib/domain/money";

/** Client Přehled on real data (spec §9): "how much money came back" first. */
export async function RealClientDashboardView({ data }: { data: RealClientDashboard }) {
  const t = await getTranslations("client");
  const tKpi = await getTranslations("kpi");
  const c = data.current;
  const deltaText =
    data.deltaVsPrevious === null
      ? t("deltaNone")
      : t("delta", {
          value: `${data.deltaVsPrevious >= 0 ? "+" : "−"}${formatPercent(Math.abs(data.deltaVsPrevious))}`,
        });

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-line bg-surface px-5 py-6 sm:px-8 sm:py-8">
        <h1 className="text-[15px] font-semibold text-ink">{data.companyName}</h1>
        <div className="mt-3 text-sm font-medium text-muted">{t("heroLabel")}</div>
        <div
          className="tnum mt-2 text-[44px] font-semibold leading-none tracking-tight text-accent sm:text-hero"
          data-testid="hero-revenue"
        >
          {formatCZK(c.revenueMinor)}
        </div>
        <div className="mt-3 flex flex-col gap-1 text-sm sm:flex-row sm:gap-4">
          <span
            className={
              data.deltaVsPrevious !== null && data.deltaVsPrevious >= 0 ? "font-medium text-accent" : "text-ink-2"
            }
          >
            {deltaText}
          </span>
          <span className="tnum text-muted" data-testid="hero-total">
            {t("totalSince", { value: formatCZK(data.totalSinceStartMinor) })}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="client-kpis">
        <KpiCard label={tKpi("reactivated")} value={formatInt(data.reactivatedCustomers)} />
        <KpiCard label={tKpi("bookings")} value={formatInt(c.bookings)} />
        <KpiCard label={tKpi("messages")} value={formatInt(c.messagesSent)} />
        <KpiCard label={tKpi("subscription")} value={formatCZK(data.subscriptionMinor)} />
        <KpiCard
          label={tKpi("roi")}
          value={formatROI(roi(c.revenueMinor, data.subscriptionMinor))}
          accent
          className="col-span-2 md:col-span-1"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("chartTitle")}</CardTitle>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("currentCampaigns")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {data.campaigns.length === 0 ? (
              <p className="text-sm text-muted">{t("noCampaigns")}</p>
            ) : (
              <ul className="space-y-4">
                {data.campaigns.map((r) => (
                  <li key={r.id} data-testid="current-campaign">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/app/campaigns/${r.id}`}
                        className="min-w-0 truncate text-sm font-medium text-ink hover:underline"
                      >
                        {r.name}
                      </Link>
                      <CampaignStatusBadge status={r.status as CampaignStatus} />
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(3, r.windowProgress * 100)}%` }}
                      />
                    </div>
                    <p className="tnum mt-1.5 text-[12px] text-muted">
                      {r.startedAt
                        ? t("campaignProgress", {
                            sent: formatInt(r.contacted),
                            booked: r.booked,
                            revenue: formatCZK(r.revenueMinor),
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
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    data-testid="recent-return"
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
        <section data-testid="opportunities">
          <SectionTitle>{t("opportunities")}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {data.opportunities.map((o, i) => (
              <OpportunityCard
                key={o.presetKey}
                opportunity={o}
                conversionRate={data.conversionRate}
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

/** Výsledky on real data (spec §8): by month, campaign and segment, plus the pooled holdout comparison. */
export async function RealResultsView({ data }: { data: RealResults }) {
  const t = await getTranslations("results");
  const tPreset = await getTranslations("presets");
  const h = data.holdout;
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label={t("total")}
            value={formatCZK(data.totalSinceStartMinor)}
            accent
            className="col-span-2 md:col-span-2"
          />
          <KpiCard label={t("campaigns")} value={formatInt(data.campaigns.length)} />
          <KpiCard label={t("smsCost")} value={formatCZK(data.smsCostMinor)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("holdoutTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-muted">{t("holdoutExplain")}</p>
            {h.sufficient ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-md bg-accent-soft px-4 py-3">
                  <div className="tnum text-xl font-semibold text-accent-strong">{formatPercent(h.treatedRate)}</div>
                  <div className="text-[12px] text-ink-2">{t("treatedRate")}</div>
                </div>
                <div className="rounded-md bg-subtle px-4 py-3">
                  <div className="tnum text-xl font-semibold text-ink">{formatPercent(h.holdoutRate)}</div>
                  <div className="text-[12px] text-ink-2">{t("holdoutRate")}</div>
                </div>
                <div className="rounded-md border border-line px-4 py-3">
                  <div className="tnum text-xl font-semibold text-accent">{formatCZK(h.incrementalMinor)}</div>
                  <div className="text-[12px] text-ink-2">{t("incremental")}</div>
                </div>
              </div>
            ) : (
              <p className="rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2" data-testid="holdout-insufficient">
                {t("insufficient", { count: h.holdoutCount })}
              </p>
            )}
          </CardContent>
        </Card>

        <section>
          <SectionTitle>{t("byMonth")}</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <Table>
              <THead>
                <TR>
                  <TH>{t("month")}</TH>
                  <TH className="text-right">{t("revenue")}</TH>
                  <TH className="text-right">{t("completed")}</TH>
                  <TH className="text-right">{t("bookings")}</TH>
                  <TH className="text-right">{t("messages")}</TH>
                  <TH className="text-right">{t("roi")}</TH>
                </TR>
              </THead>
              <TBody>
                {data.series.map((m) => (
                  <TR key={m.month} data-testid="results-month">
                    <TD className="whitespace-nowrap capitalize">{formatMonthLong(m.month)}</TD>
                    <TD className="tnum text-right font-medium text-accent">{formatCZK(m.revenueMinor)}</TD>
                    <TD className="tnum text-right">{formatInt(m.completed)}</TD>
                    <TD className="tnum text-right">{formatInt(m.bookings)}</TD>
                    <TD className="tnum text-right">{formatInt(m.messagesSent)}</TD>
                    <TD className="tnum text-right">{formatROI(m.roi)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section>
            <SectionTitle>{t("byCampaign")}</SectionTitle>
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <Table>
                <THead>
                  <TR>
                    <TH>{t("campaigns")}</TH>
                    <TH className="text-right">{t("sent")}</TH>
                    <TH className="text-right">{t("completed")}</TH>
                    <TH className="text-right">{t("revenue")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.campaigns.map((c) => (
                    <TR key={c.id} data-testid="results-campaign">
                      <TD>
                        <Link href={`/app/campaigns/${c.id}`} className="font-medium text-ink hover:underline">
                          {c.name}
                        </Link>
                      </TD>
                      <TD className="tnum text-right">{formatInt(c.contacted)}</TD>
                      <TD className="tnum text-right">{formatInt(c.completed)}</TD>
                      <TD className="tnum whitespace-nowrap text-right font-medium text-accent">
                        {formatCZK(c.revenueMinor)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
          <section>
            <SectionTitle>{t("bySegment")}</SectionTitle>
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <Table>
                <THead>
                  <TR>
                    <TH>{t("bySegment")}</TH>
                    <TH className="text-right">{t("sent")}</TH>
                    <TH className="text-right">{t("completed")}</TH>
                    <TH className="text-right">{t("revenue")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.segments.map((s) => (
                    <TR key={s.presetKey}>
                      <TD className="font-medium text-ink">
                        {s.presetKey === "custom"
                          ? t("customSegment")
                          : tPreset(`${s.presetKey as "no_visit_12m"}.name`)}
                      </TD>
                      <TD className="tnum text-right">{formatInt(s.sent)}</TD>
                      <TD className="tnum text-right">{formatInt(s.completed)}</TD>
                      <TD className="tnum whitespace-nowrap text-right font-medium text-accent">
                        {formatCZK(s.revenueMinor)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
