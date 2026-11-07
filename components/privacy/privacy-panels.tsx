import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { KeepFlaggedButton, RequestDecision } from "@/components/privacy/dsr-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { DsrRow, RetentionSummary } from "@/lib/db/supabase/privacy";
import { addDays, formatDate } from "@/lib/domain/dates";
import { dsrDaysLeft } from "@/lib/domain/privacy";

const STATUS_TONE = { open: "warn", completed: "accent", rejected: "neutral" } as const;

/**
 * Data subject requests of one shop (spec §21). The operator sees actions;
 * the owner sees the status of what they asked for.
 */
export async function DsrTable({
  rows,
  companyId,
  customerHref,
  operator,
  now,
  emptyText,
}: {
  rows: DsrRow[];
  companyId: string;
  customerHref: ((customerId: string) => string) | null;
  operator: boolean;
  now: Date;
  emptyText: string;
}) {
  const t = await getTranslations("dsr");
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
        {emptyText}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <Table>
        <THead>
          <TR>
            <TH>{t("columns.type")}</TH>
            <TH>{t("columns.customer")}</TH>
            <TH>{t("columns.created")}</TH>
            <TH>{t("columns.due")}</TH>
            <TH>{t("columns.status")}</TH>
            {operator && <TH className="sr-only">{t("complete")}</TH>}
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            const left = dsrDaysLeft(r.dueAt, now);
            return (
              <TR key={r.id} data-testid="dsr-row">
                <TD>
                  <span className="font-medium text-ink">{t(`types.${r.type}`)}</span>
                  <span className="block text-[12px] text-muted">{t(`sources.${r.source}`)}</span>
                </TD>
                <TD>
                  {r.customerId && customerHref ? (
                    <Link href={customerHref(r.customerId)} className="text-ink hover:underline">
                      {r.customerName ?? "—"}
                    </Link>
                  ) : (
                    <span className="text-muted">{r.customerId ? (r.customerName ?? "—") : t("erased")}</span>
                  )}
                </TD>
                <TD className="tnum whitespace-nowrap text-ink-2">{formatDate(r.createdAt)}</TD>
                <TD className="tnum whitespace-nowrap">
                  <span className="text-ink-2">{formatDate(r.dueAt)}</span>
                  {r.status === "open" && (
                    <span
                      className={`block text-[12px] ${left < 0 ? "text-danger" : left <= 10 ? "text-warn" : "text-muted"}`}
                    >
                      {left < 0 ? t("overdue") : t("daysLeft", { days: left })}
                    </span>
                  )}
                </TD>
                <TD>
                  <Badge tone={STATUS_TONE[r.status]}>{t(`statuses.${r.status}`)}</Badge>
                </TD>
                {operator && (
                  <TD className="text-right">
                    {r.status === "open" && (
                      <div className="flex flex-col items-end gap-2">
                        {r.type === "access" && r.customerId && (
                          <a
                            href={`/admin/companies/${companyId}/customers/${r.customerId}/export`}
                            className="text-[13px] font-medium text-accent underline-offset-4 hover:underline"
                          >
                            {t("export")}
                          </a>
                        )}
                        <RequestDecision companyId={companyId} requestId={r.id} type={r.type} />
                      </div>
                    )}
                  </TD>
                )}
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

/** Customers flagged by the nightly retention run (spec §21), with the shop's objection. */
export async function RetentionCard({
  summary,
  companyId,
  canKeep,
}: {
  summary: RetentionSummary;
  companyId: string;
  canKeep: boolean;
}) {
  const t = await getTranslations("retention");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        {summary.flagged > 0 && canKeep && <KeepFlaggedButton companyId={companyId} />}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] text-muted">{t("description")}</p>
        {summary.flagged === 0 ? (
          <p className="text-sm text-ink-2" data-testid="retention-none">
            {t("none")}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium text-ink" data-testid="retention-count">
              {t("count", { count: summary.flagged, date: formatDate(addDays(summary.firstFlaggedAt!, 30)) })}
            </p>
            <ul className="text-[13px] text-ink-2">
              {summary.sample.map((c) => (
                <li key={c.id}>
                  {c.name} · {c.lastVisitAt ? t("lastVisit", { date: formatDate(c.lastVisitAt) }) : t("noVisit")}
                </li>
              ))}
              {summary.flagged > summary.sample.length && (
                <li className="text-muted">{t("more", { count: summary.flagged - summary.sample.length })}</li>
              )}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
