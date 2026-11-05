import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ConversionButtons } from "@/components/conversions/conversion-buttons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  campaignRecipients,
  campaignResults,
  RECIPIENT_FILTERS,
  RECIPIENTS_PAGE_SIZE,
  type RecipientFilter,
} from "@/lib/db/supabase/conversions";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK, formatInt, formatPercent } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

/**
 * Results and recipients of a started campaign (spec §8, §14): recovered
 * revenue from completed, non-holdout returns, the holdout comparison
 * (only from 30 holdout customers), and the pipeline buttons per recipient.
 */
export async function CampaignRecipients({
  companyId,
  campaignId,
  pagePath,
  customerHref,
  filter,
  page,
  canMark,
}: {
  companyId: string;
  campaignId: string;
  pagePath: string;
  customerHref: string;
  filter: RecipientFilter;
  page: number;
  canMark: boolean;
}) {
  const [t, tStage, results, list] = await Promise.all([
    getTranslations("campaignResults"),
    getTranslations("stage"),
    campaignResults(companyId, campaignId),
    campaignRecipients(companyId, campaignId, { filter, page }),
  ]);
  if (results.treated + results.holdout === 0) return null;
  const now = new Date().toISOString();
  const pages = Math.max(1, Math.ceil(list.total / RECIPIENTS_PAGE_SIZE));
  const href = (f: RecipientFilter, p = 1) => `${pagePath}?stav=${f}${p > 1 ? `&strana=${p}` : ""}#prijemci`;
  const c = results.comparison;

  return (
    <>
      <Card data-testid="campaign-results">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            {(
              [
                ["revenue", formatCZK(results.revenueMinor)],
                ["completed", formatInt(results.completed)],
                ["booked", formatInt(results.booked)],
                ["rate", formatPercent(c.treatedRate)],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt className="text-[12px] text-muted">{t(`facts.${key}`)}</dt>
                <dd className="tnum font-semibold text-ink" data-testid={`results-${key}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[13px] text-ink-2" data-testid="holdout-comparison">
            {c.sufficient
              ? t("comparison", {
                  holdoutRate: formatPercent(c.holdoutRate),
                  holdout: formatInt(results.holdoutCompleted),
                  incremental: formatCZK(c.incrementalMinor),
                })
              : t("insufficient", { count: results.holdout })}
          </p>
        </CardContent>
      </Card>

      <Card id="prijemci">
        <CardHeader>
          <CardTitle>{t("recipients")}</CardTitle>
          <span className="text-[12px] text-muted">{formatInt(list.total)}</span>
        </CardHeader>
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {RECIPIENT_FILTERS.map((f) => (
            <Link
              key={f}
              href={href(f)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[12px]",
                f === filter ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:bg-subtle",
              )}
            >
              {t(`filters.${f}`)}
            </Link>
          ))}
        </div>
        {list.rows.length === 0 ? (
          <p className="border-t border-line px-5 py-8 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>{t("columns.customer")}</TH>
                  <TH>{t("columns.stage")}</TH>
                  <TH className="text-right">{t("columns.revenue")}</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {list.rows.map((e) => (
                  <TR key={e.id} data-testid="recipient-row">
                    <TD>
                      <Link href={`${customerHref}/${e.customerId}`} className="font-medium text-ink hover:underline">
                        {e.customerName || "—"}
                      </Link>
                      <div className="text-[12px] text-muted">
                        {e.vehicle ?? ""}
                        {e.completedAt && <> · {formatDate(e.completedAt)}</>}
                      </div>
                    </TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={e.stage === "completed" ? "accent" : "neutral"}>{tStage(e.stage)}</Badge>
                        {e.isHoldout && <Badge tone="info">{t("holdoutBadge")}</Badge>}
                      </span>
                    </TD>
                    <TD className="tnum text-right text-ink-2">
                      {e.revenueMinor !== null ? formatCZK(e.revenueMinor) : "—"}
                    </TD>
                    <TD>
                      {canMark && (
                        <ConversionButtons
                          companyId={companyId}
                          enrollment={e}
                          customerName={e.customerName}
                          campaignName={e.campaignName}
                          revenueMinor={e.revenueMinor}
                          completedAt={e.completedAt}
                          now={now}
                          compact
                        />
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px]">
            {page > 1 ? <Link href={href(filter, page - 1)}>{t("prev")}</Link> : <span />}
            <span className="text-muted">{t("page", { page, pages })}</span>
            {page < pages ? <Link href={href(filter, page + 1)}>{t("next")}</Link> : <span />}
          </div>
        )}
      </Card>
    </>
  );
}
