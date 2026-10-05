import { ArrowRight, Target } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { OpportunityView } from "@/lib/db/queries";
import { formatCZK, formatPercent, roundEstimateMinor } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

/**
 * Deterministic opportunity card (spec §9): "71 zákazníků u vás nebylo 12+
 * měsíců · očekávané tržby ~ 18 000 Kč". Admin gets "Vytvořit kampaň";
 * the managed-mode client view gets a disabled "Požádat o kampaň".
 */
export function OpportunityCard({
  opportunity,
  conversionRate,
  recommended = false,
  href,
  readOnly = false,
}: {
  opportunity: OpportunityView;
  conversionRate: number;
  recommended?: boolean;
  href?: string;
  readOnly?: boolean;
}) {
  const t = useTranslations("opportunity");
  const tPreset = useTranslations("presets");
  const tView = useTranslations("supportView");
  const o = opportunity;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-surface p-4",
        recommended ? "border-accent-line ring-1 ring-accent-line" : "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-muted">{tPreset(`${o.presetKey}.name`)}</span>
        {recommended && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-strong">
            <Target className="size-3" aria-hidden />
            {t("recommended")}
          </span>
        )}
      </div>
      <p className="mt-2 text-[15px] font-semibold leading-snug text-ink">
        {tPreset(`${o.presetKey}.opportunity`, { count: o.eligible })}
      </p>
      <div className="mt-3">
        <div className="text-[12px] text-muted">{t("expected")}</div>
        <div className="tnum text-xl font-semibold text-accent">
          {t("expectedValue", { value: formatCZK(roundEstimateMinor(o.expectedRevenueMinor)) })}
        </div>
        <div className="mt-0.5 text-[12px] text-muted">
          {t("basis", { rate: formatPercent(conversionRate), avg: formatCZK(o.avgJobValueMinor) })}
        </div>
      </div>
      <div className="mt-4 flex-1" />
      {readOnly ? (
        <Button variant="outline" size="sm" disabled title={tView("readOnlyHint")} className="w-full">
          {t("requestCampaign")}
        </Button>
      ) : (
        href && (
          <Button asChild variant={recommended ? "accent" : "outline"} size="sm" className="w-full">
            <Link href={href}>
              {t("createCampaign")} <ArrowRight />
            </Link>
          </Button>
        )
      )}
    </div>
  );
}
