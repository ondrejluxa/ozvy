"use client";

import { CheckCircle2, FlaskConical, Loader2, Send } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { simulateSendBatchAction } from "@/lib/actions/campaigns";
import type { SendProgress } from "@/lib/db/mutations";
import { formatInt } from "@/lib/domain/money";

/**
 * Drives the dispatcher tick by tick through the mock SMS provider and shows
 * live progress. In Phase 1 the same ticks run in a background job and this
 * panel only polls the status.
 */
export function SendPanel({
  companyId,
  campaignId,
  total,
  autoStart,
}: {
  companyId: string;
  campaignId: string;
  total: number;
  autoStart: boolean;
}) {
  const t = useTranslations("send");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  const run = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setRunning(true);
    for (let i = 0; i < 200; i++) {
      const res = await simulateSendBatchAction({ companyId, campaignId });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        setRunning(false);
        started.current = false;
        return;
      }
      setProgress(res.data);
      if (res.data.done) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    setRunning(false);
    window.setTimeout(() => {
      router.replace(pathname, { scroll: false });
      router.refresh();
    }, 900);
  }, [campaignId, companyId, pathname, router, tErrors]);

  useEffect(() => {
    if (autoStart) {
      const id = window.setTimeout(run, 400);
      return () => window.clearTimeout(id);
    }
  }, [autoStart, run]);

  const sent = progress?.sent ?? 0;
  const all = progress?.total ?? total;
  const pct = all ? Math.round(((progress?.processed ?? 0) / all) * 100) : 0;
  const done = progress?.done ?? false;

  return (
    <div className="rounded-lg border border-info/25 bg-info-soft/60 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            {done ? (
              <CheckCircle2 className="size-4 text-accent" aria-hidden />
            ) : (
              <Send className="size-4 text-info" aria-hidden />
            )}
            {t("title")}
          </h2>
          <p className="mt-1 max-w-xl text-[13px] text-ink-2">{t("description")}</p>
        </div>
        {!running && !done && (
          <Button variant="accent" onClick={run}>
            <Send aria-hidden />
            {t("start")}
          </Button>
        )}
      </div>

      {(running || progress) && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span className="tnum font-medium text-ink">
              {done ? (
                t("done", { delivered: formatInt(progress?.delivered ?? 0) })
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  {t("progress", { sent: formatInt(sent), total: formatInt(all) })}
                </span>
              )}
            </span>
            <span className="tnum text-muted">
              {t("delivered", { count: formatInt(progress?.delivered ?? 0) })} ·{" "}
              {t("failed", { count: formatInt(progress?.failed ?? 0) })}
            </span>
          </div>
          {done && <p className="mt-3 text-[13px] text-ink-2">{t("nextStep")}</p>}
        </div>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-muted">
        <FlaskConical className="size-3.5" aria-hidden />
        {t("mockNote")}
      </p>
    </div>
  );
}
