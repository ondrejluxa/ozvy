"use client";

import { ArrowRight, ChevronDown, Presentation, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { exitClientViewAction, openClientViewAction, resetDemoAction } from "@/lib/actions/demo";
import { cn } from "@/lib/utils";

/**
 * Presentation guide for the 5-minute sales demo. It reads the current route
 * and shows where the presenter is in the main scenario and what to click
 * next. Purely a demo aid: it renders only when DEMO_MODE is on.
 */

const STEPS = ["admin", "company", "segment", "message", "review", "send", "results", "client"] as const;
type StepKey = (typeof STEPS)[number];
const STORAGE_KEY = "navrat.demoGuide.collapsed";

function stepFor(pathname: string, search: URLSearchParams, companyId: string): StepKey | null {
  const base = `/admin/companies/${companyId}`;
  if (pathname === "/admin") return "admin";
  if (pathname === base) return "company";
  if (pathname === `${base}/campaigns/new`) {
    const step = search.get("step");
    if (step === "message") return "message";
    if (step === "schedule" || step === "review") return "review";
    return "segment";
  }
  if (pathname.startsWith(`${base}/campaigns/`)) return search.get("sending") ? "send" : "results";
  if (pathname === "/app" || pathname.startsWith("/app/")) return "client";
  return null;
}

export function DemoGuide({
  primaryCompanyId,
  recommendedPreset,
}: {
  primaryCompanyId: string;
  recommendedPreset: string | null;
}) {
  const t = useTranslations("guide");
  const tDemo = useTranslations("demo");
  const pathname = usePathname();
  const search = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-viewer preference after hydration
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable: keep expanded */
    }
  }, []);

  const toggle = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const step = stepFor(pathname, search, primaryCompanyId);
  const index = step ? STEPS.indexOf(step) : -1;

  const reset = () => setConfirmOpen(true);
  const confirmReset = () => {
    setConfirmOpen(false);
    startTransition(() => resetDemoAction());
  };
  const confirmDialog = (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent closeLabel={t("collapse")}>
        <DialogTitle>{tDemo("reset")}</DialogTitle>
        <DialogDescription>{tDemo("resetConfirm")}</DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
            {tDemo("cancel")}
          </Button>
          <Button variant="danger" onClick={confirmReset}>
            {tDemo("reset")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => toggle(false)}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink shadow-lg hover:bg-subtle"
      >
        <Presentation className="size-4 text-accent" aria-hidden />
        {t("expand")}
        {index >= 0 && (
          <span className="tnum text-muted">
            {index + 1}/{STEPS.length}
          </span>
        )}
      </button>
    );
  }

  const companyBase = `/admin/companies/${primaryCompanyId}`;
  let action: React.ReactNode = null;
  if (step === "admin") {
    action = (
      <Button asChild variant="accent" size="sm">
        <Link href={companyBase}>
          {t("steps.admin.action")} <ArrowRight />
        </Link>
      </Button>
    );
  } else if (step === "company") {
    action = (
      <Button asChild variant="accent" size="sm">
        <Link href={`${companyBase}/campaigns/new${recommendedPreset ? `?preset=${recommendedPreset}` : ""}`}>
          {t("steps.company.action")} <ArrowRight />
        </Link>
      </Button>
    );
  } else if (step === "results") {
    action = (
      <Button
        variant="accent"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(() => openClientViewAction(primaryCompanyId))}
      >
        {t("steps.results.action")} <ArrowRight />
      </Button>
    );
  } else if (step === "client") {
    action = (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(() => exitClientViewAction())}
      >
        {t("steps.client.action")}
      </Button>
    );
  } else if (step === null) {
    action = (
      <Button asChild variant="outline" size="sm">
        <Link href="/admin">{t("start")}</Link>
      </Button>
    );
  }

  return (
    <aside
      aria-label={t("title")}
      className="fixed inset-x-4 bottom-4 z-30 rounded-lg border border-line bg-surface shadow-xl sm:inset-x-auto sm:right-4 sm:w-[340px]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 text-[12px] font-medium text-muted">
          <Presentation className="size-4 text-accent" aria-hidden />
          {t("title")}
          {index >= 0 && <span className="tnum">· {t("step", { current: index + 1, total: STEPS.length })}</span>}
        </div>
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label={t("collapse")}
          className="rounded p-1 text-muted hover:bg-subtle hover:text-ink"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      <div className="px-4 py-3">
        <ol className="mb-3 flex gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full",
                i < index ? "bg-accent/40" : i === index ? "bg-accent" : "bg-line",
              )}
            />
          ))}
        </ol>
        {step ? (
          <>
            <p className="text-sm font-semibold text-ink">{t(`steps.${step}.title`)}</p>
            <p className="mt-1 text-[13px] leading-5 text-ink-2">{t(`steps.${step}.hint`)}</p>
          </>
        ) : (
          <p className="text-[13px] text-ink-2">{t("outside")}</p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div>{action}</div>
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {tDemo("reset")}
          </button>
        </div>
      </div>
      {confirmDialog}
    </aside>
  );
}
