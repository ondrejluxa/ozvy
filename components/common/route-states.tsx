"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary content inside the app shell (spec §24: every page has an
 * error boundary with retry and an error ID). The sidebar stays usable.
 */
export function SectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  useEffect(() => {
    // The digest links the browser report to the server log; no personal data.
    console.error("[page] render failed", error.digest ?? "");
  }, [error.digest]);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <AlertTriangle className="size-6 text-warn" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold text-ink">{t("boundaryTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("internal")}</p>
      {error.digest && (
        <p className="mt-1 font-mono text-[12px] text-faint">
          {t("errorId")}: {error.digest}
        </p>
      )}
      <Button className="mt-6" onClick={reset}>
        {t("retry")}
      </Button>
    </div>
  );
}
