import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getSupportView } from "@/lib/auth/context";
import { getResults } from "@/lib/db/queries";
import { formatMonthLong } from "@/lib/domain/dates";
import { formatCZK, formatInt, formatPercent, formatROI } from "@/lib/domain/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("results");
  return { title: t("title") };
}

/** Výsledky (spec §8): revenue by month, campaign and segment, plus the pooled holdout comparison. */
export default async function ResultsPage() {
  const view = await getSupportView();
  if (!view) redirect("/admin");
  const data = getResults(view.companyId);
  if (!data) redirect("/admin");
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
            demo
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
              <p className="rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2">
                {t("insufficient", { count: h.holdoutCount })}
              </p>
            )}
          </CardContent>
        </Card>

        <section>
          <SectionTitle>{t("byMonth")}</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
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
                  <TR key={m.month}>
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
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
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
                  {data.campaigns.map((r) => (
                    <TR key={r.campaign.id}>
                      <TD>
                        <Link href={`/app/campaigns/${r.campaign.id}`} className="font-medium text-ink hover:underline">
                          {r.campaign.name}
                        </Link>
                      </TD>
                      <TD className="tnum text-right">{formatInt(r.stats.sent)}</TD>
                      <TD className="tnum text-right">{formatInt(r.stats.completed)}</TD>
                      <TD className="tnum whitespace-nowrap text-right font-medium text-accent">
                        {formatCZK(r.stats.revenueMinor)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
          <section>
            <SectionTitle>{t("bySegment")}</SectionTitle>
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
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
                      <TD className="font-medium text-ink">{tPreset(`${s.presetKey}.name`)}</TD>
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
