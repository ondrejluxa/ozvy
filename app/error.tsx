"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-xl font-semibold text-ink">{t("boundaryTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("internal")}</p>
      {error.digest && <p className="mt-1 font-mono text-[12px] text-faint">{error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        {t("retry")}
      </Button>
    </main>
  );
}
