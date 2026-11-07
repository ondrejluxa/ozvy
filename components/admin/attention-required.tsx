import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompanyName } from "@/components/demo/demo-labels";
import type { AlertRow } from "@/lib/db/queries";
import type { AlertSeverity } from "@/lib/domain/alerts/rules";
import { formatDate, formatRelative, formatTime } from "@/lib/domain/dates";
import { formatCZK, formatInt, formatPercent, roundEstimateMinor } from "@/lib/domain/money";

const SEVERITY_TONE: Record<AlertSeverity, "danger" | "warn" | "neutral" | "info" | "accent"> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "neutral",
  info: "accent",
};

function actionHref(a: AlertRow): string {
  const base = `/admin/companies/${a.companyId}`;
  switch (a.type) {
    case "campaign_failed":
    case "awaiting_approval":
    case "low_conversion":
      return `${base}/campaigns/${a.campaignId}`;
    case "provider_paused":
      return "/admin/system";
    case "import_needs_review":
    case "import_stuck":
      return `${base}/imports/${a.params.importId}`;
    case "dsr_due":
      return `${base}/privacy`;
    case "sms_failure_rate":
      return `${base}/campaigns`;
    case "no_campaign_running":
      return `${base}/segments`;
    case "large_opportunity":
      return `${base}/campaigns/new?preset=${a.presetKey}`;
    default:
      return base;
  }
}

/** Attention Required (spec §10): open alerts by severity, each with one action. */
export async function AttentionRequired({
  alerts,
  now,
  showCompany = true,
}: {
  alerts: AlertRow[];
  now: Date;
  showCompany?: boolean;
}) {
  const t = await getTranslations("alerts");
  const tSeverity = await getTranslations("severity");
  const tPreset = await getTranslations("presets");
  const tDsr = await getTranslations("dsr");

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-accent-line bg-accent-soft px-4 py-3 text-sm text-accent-strong">
        <CheckCircle2 className="size-4" aria-hidden />
        {t("allGood", { time: formatTime(now) })}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {alerts.map((a) => {
        const params: Record<string, string | number> = {
          campaign: a.campaignName ?? "",
          days: Number(a.params.days ?? 0),
          rate: typeof a.params.rate === "number" ? formatPercent(a.params.rate) : "",
          eligible: typeof a.params.eligible === "number" ? formatInt(a.params.eligible) : "",
          expected: typeof a.params.expected === "number" ? formatCZK(roundEstimateMinor(a.params.expected)) : "",
          preset: a.presetKey ? tPreset(`${a.presetKey}.name`) : "",
          minutes: Number(a.params.minutes ?? 0),
          requestType: typeof a.params.requestType === "string" ? tDsr(`types.${a.params.requestType}`) : "",
          dueAt: typeof a.params.dueAt === "string" ? formatDate(a.params.dueAt) : "",
        };
        return (
          <li key={a.key} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Badge tone={SEVERITY_TONE[a.severity]} className="mt-0.5 shrink-0">
                {tSeverity(a.severity)}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{t(`${a.type}.title`, params)}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {showCompany && a.companyName && (
                    <>
                      <CompanyName name={a.companyName} /> ·{" "}
                    </>
                  )}
                  {formatRelative(a.createdAt, now)}
                </p>
              </div>
            </div>
            <Button
              asChild
              size="sm"
              variant={a.type === "large_opportunity" ? "accent" : "outline"}
              className="self-start sm:self-auto"
            >
              <Link href={actionHref(a)}>{t(`${a.type}.action`)}</Link>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
