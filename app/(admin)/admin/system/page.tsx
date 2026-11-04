import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { KillSwitch, ReviewButtons, RunQueueButton } from "@/components/admin/system-controls";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePageContext } from "@/lib/auth/context";
import { getSystemOverview } from "@/lib/db/supabase/messaging";
import { formatDateTime } from "@/lib/domain/dates";
import { formatInt } from "@/lib/domain/money";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("system");
  return { title: t("title") };
}

/**
 * System page (spec §20): the global send kill switch, queue health and the
 * manual review of messages stuck in 'sending'. Real data only.
 */
export default async function SystemPage() {
  if (env.DATA_SOURCE !== "supabase") notFound();
  await requirePageContext({ permission: "admin.access" }, "/admin/system");
  const [t, overview] = await Promise.all([getTranslations("system"), getSystemOverview()]);
  const { killSwitch, queue, review } = overview;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("killSwitch")}</CardTitle>
            <Badge tone={killSwitch.paused ? "danger" : "accent"} data-testid="kill-switch-state">
              {killSwitch.paused ? t("stateStopped") : t("stateRunning")}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {killSwitch.paused ? (
              <p className="text-sm text-danger">
                {t("stoppedSince", { at: killSwitch.at ? formatDateTime(killSwitch.at) : "" })} {killSwitch.reason}
              </p>
            ) : (
              <p className="text-[13px] text-muted">{t("killSwitchHint")}</p>
            )}
            <KillSwitch paused={killSwitch.paused} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("queue")}</CardTitle>
            {env.JOB_RUNNER === "inline" && <RunQueueButton />}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
              {(
                [
                  ["queued", queue.queued],
                  ["sending", queue.sending],
                  ["needsReview", queue.needsReview],
                  ["sent24h", queue.sent24h],
                  ["failed24h", queue.failed24h],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-[12px] text-muted">{t(`stats.${key}`)}</dt>
                  <dd className="tnum font-semibold text-ink" data-testid={`queue-${key}`}>
                    {formatInt(value)}
                  </dd>
                </div>
              ))}
            </dl>
            {queue.oldestQueuedAt && (
              <p className="mt-3 text-[12px] text-muted">
                {t("oldestQueued", { at: formatDateTime(queue.oldestQueuedAt) })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("reviewTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-[13px] text-muted">{t("reviewHint")}</p>
          </CardContent>
          {review.length === 0 ? (
            <p className="border-t border-line px-5 py-8 text-center text-sm text-muted">{t("reviewEmpty")}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t("columns.company")}</TH>
                  <TH>{t("columns.campaign")}</TH>
                  <TH>{t("columns.since")}</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {review.map((m) => (
                  <TR key={m.id} data-testid="review-message">
                    <TD className="text-ink">{m.companyName}</TD>
                    <TD className="text-ink-2">{m.campaignName ?? "—"}</TD>
                    <TD className="text-ink-2">{m.at ? formatDateTime(m.at) : "—"}</TD>
                    <TD>
                      <ReviewButtons messageId={m.id} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
