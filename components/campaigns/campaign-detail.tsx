import { Clock, Search, Users } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CampaignStatusBadge, MessageStatusBadge, StageBadge } from "@/components/common/badges";
import { ConversionActions } from "@/components/customers/conversion-actions";
import { DemoTag } from "@/components/demo/demo-labels";
import { SendPanel } from "@/components/campaigns/send-panel";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/inputs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { RecipientFilter, getCampaignDetail } from "@/lib/db/queries";
import { formatDate, formatDateTime } from "@/lib/domain/dates";
import { formatCZK, formatInt, formatPercent, roundEstimateMinor } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

type Detail = NonNullable<ReturnType<typeof getCampaignDetail>>;
const FILTERS: RecipientFilter[] = ["all", "booked", "completed", "holdout", "failed"];

export async function CampaignDetail({
  data,
  backHref,
  basePath,
  customerHref,
  readOnly,
  autoSend,
  q,
}: {
  data: Detail;
  backHref: string;
  basePath: string;
  customerHref: (customerId: string) => string;
  readOnly: boolean;
  autoSend: boolean;
  q?: string;
}) {
  const t = await getTranslations("campaign");
  const tPreset = await getTranslations("presets");
  const c = data.campaign;
  const s = data.stats;
  const sendable = c.status === "scheduled" || c.status === "sending";
  const windowEnd = s.sentAt ? new Date(s.sentAt.getTime() + c.attribution_window_days * 86_400_000) : null;

  const href = (filter: RecipientFilter, page = 1) => {
    const p = new URLSearchParams();
    if (filter !== "all") p.set("filter", filter);
    if (q) p.set("q", q);
    if (page > 1) p.set("page", String(page));
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const funnel = [
    { key: "sent", value: s.sent, base: s.treated },
    { key: "delivered", value: s.delivered, base: s.sent },
    { key: "booked", value: s.booked, base: s.delivered },
    { key: "completed", value: s.completed, base: s.booked },
  ] as const;

  return (
    <>
      <PageHeader
        back={{ href: backHref, label: t("back") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.name} <CampaignStatusBadge status={c.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {c.segment_preset && <span>{tPreset(`${c.segment_preset}.name`)}</span>}
            <span className="tnum">
              {s.sentAt
                ? t("sentOn", { date: formatDateTime(s.sentAt) })
                : c.scheduled_at
                  ? t("scheduledFor", { date: formatDateTime(c.scheduled_at) })
                  : null}
            </span>
            {windowEnd && <span className="tnum">{t("window", { date: formatDate(windowEnd) })}</span>}
          </span>
        }
      />

      <div className="space-y-6">
        {sendable && !readOnly && (
          <SendPanel companyId={data.company.id} campaignId={c.id} total={s.treated} autoStart={autoSend} />
        )}
        {c.status === "waiting_for_approval" && (
          <div className="flex items-center gap-2 rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn">
            <Clock className="size-4" aria-hidden />
            {t("waiting", { date: c.scheduled_at ? formatDateTime(c.scheduled_at) : "—" })}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("funnel")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {funnel.map((f, i) => (
                  <div key={f.key} className="relative">
                    <div className="text-[12px] text-muted">{t(`funnelSteps.${f.key}`)}</div>
                    <div
                      className={cn("tnum text-2xl font-semibold", f.key === "completed" ? "text-accent" : "text-ink")}
                    >
                      {formatInt(f.value)}
                    </div>
                    {i > 0 && f.base > 0 && (
                      <div className="tnum text-[12px] text-muted">{formatPercent(f.value / f.base)}</div>
                    )}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
                      <div
                        className={cn("h-full rounded-full", f.key === "completed" ? "bg-accent" : "bg-ink/70")}
                        style={{ width: `${s.treated ? Math.max(2, (f.value / s.treated) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-col gap-1 border-t border-line pt-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[12px] text-muted">
                    {t("revenue")} <DemoTag />
                  </div>
                  <div className="tnum text-[32px] font-semibold leading-10 tracking-tight text-accent">
                    {formatCZK(s.revenueMinor)}
                  </div>
                  <div className="text-[12px] text-muted">
                    {t("expected", { value: formatCZK(roundEstimateMinor(data.expectedRevenueMinor)) })}
                  </div>
                </div>
                {s.sent > 0 && (
                  <div className="tnum text-[12px] text-muted">
                    {t("cost", { value: formatCZK(s.costMinor), count: formatInt(s.segments) })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("holdoutTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-[13px] text-muted">{t("holdoutExplain", { count: s.holdout })}</p>
              {data.holdout.sufficient ? (
                <>
                  <div className="flex justify-between">
                    <span>{t("treated")}</span>
                    <span className="tnum font-medium">
                      {t("returned", { rate: formatPercent(data.holdout.treatedRate) })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("control")}</span>
                    <span className="tnum font-medium">
                      {t("returned", { rate: formatPercent(data.holdout.holdoutRate) })}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-line pt-3">
                    <span>{t("incremental")}</span>
                    <span className="tnum font-semibold text-accent">{formatCZK(data.holdout.incrementalMinor)}</span>
                  </div>
                </>
              ) : (
                <p className="rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2">
                  {t("holdoutInsufficient", { count: s.holdout })}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {(data.sampleMessage || data.step) && (
          <Card>
            <CardHeader>
              <CardTitle>{data.sampleMessage ? t("message") : t("template")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="max-w-2xl rounded-2xl rounded-bl-sm bg-subtle px-4 py-3 text-[14px] leading-5 text-ink">
                {data.sampleMessage ?? data.step?.body_template}
              </p>
            </CardContent>
          </Card>
        )}

        {data.counts.all > 0 && (
          <section>
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <Users className="size-4 text-muted" aria-hidden />
                {t("recipients")}
              </h2>
              <form method="get" action={basePath} className="relative sm:w-72">
                {data.filter !== "all" && <input type="hidden" name="filter" value={data.filter} />}
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
                  aria-hidden
                />
                <Input name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} className="pl-9" />
              </form>
            </div>
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="flex gap-1 overflow-x-auto px-3 pt-2 shadow-[inset_0_-1px_0_var(--color-line)]">
                {FILTERS.map((f) => (
                  <Link
                    key={f}
                    href={href(f)}
                    scroll={false}
                    className={cn(
                      "whitespace-nowrap border-b-2 px-2.5 pb-2 pt-1 text-[13px]",
                      data.filter === f
                        ? "border-accent font-medium text-ink"
                        : "border-transparent text-muted hover:text-ink",
                    )}
                  >
                    {t(`recipientsFilter.${f}`)} <span className="tnum text-faint">{data.counts[f]}</span>
                  </Link>
                ))}
              </div>
              {data.recipients.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted">{t("noRecipients")}</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>{t("columns.customer")}</TH>
                      <TH>{t("columns.vehicle")}</TH>
                      <TH>{t("columns.message")}</TH>
                      <TH>{t("columns.stage")}</TH>
                      <TH className="text-right">{t("columns.revenue")}</TH>
                      {!readOnly && <TH />}
                    </TR>
                  </THead>
                  <TBody>
                    {data.recipients.map((r) => (
                      <TR key={r.id} className={cn(r.isHoldout && "bg-subtle/50")}>
                        <TD className="whitespace-nowrap">
                          <Link href={customerHref(r.customerId)} className="font-medium text-ink hover:underline">
                            {r.customerName}
                          </Link>
                          <span className="tnum block text-[12px] text-muted">{r.phone}</span>
                        </TD>
                        <TD className="whitespace-nowrap">
                          {r.vehicle ?? "—"}{" "}
                          {r.plate && <span className="font-mono text-[12px] text-muted">{r.plate}</span>}
                        </TD>
                        <TD>
                          {r.isHoldout ? (
                            <Badge tone="outline">{t("holdoutBadge")}</Badge>
                          ) : r.messageStatus ? (
                            <MessageStatusBadge status={r.messageStatus} />
                          ) : (
                            <span className="text-[12px] text-faint">{t("notSent")}</span>
                          )}
                        </TD>
                        <TD>
                          {r.isHoldout && r.stage === "contacted" ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <StageBadge stage={r.stage} />
                          )}
                        </TD>
                        <TD className="tnum whitespace-nowrap text-right font-medium text-accent">
                          {r.revenueMinor !== null ? formatCZK(r.revenueMinor) : ""}
                        </TD>
                        {!readOnly && (
                          <TD className="text-right">
                            {(r.firstSentAt || r.isHoldout) &&
                              (r.windowOpen || r.stage === "booked" || r.stage === "completed") && (
                                <ConversionActions
                                  companyId={data.company.id}
                                  enrollmentId={r.id}
                                  stage={r.stage}
                                  isHoldout={r.isHoldout}
                                  customerName={r.customerName}
                                  campaignName={c.name}
                                  revenueMinor={r.revenueMinor}
                                  compact
                                />
                              )}
                          </TD>
                        )}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {data.pages > 1 && (
                <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[13px]">
                  <span className="text-muted">
                    {data.page} / {data.pages}
                  </span>
                  <div className="flex gap-2">
                    {data.page > 1 && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={href(data.filter, data.page - 1)} scroll={false}>
                          ←
                        </Link>
                      </Button>
                    )}
                    {data.page < data.pages && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={href(data.filter, data.page + 1)} scroll={false}>
                          →
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
