import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { optOutAction } from "@/lib/actions/opt-out";
import { createServiceClient } from "@/lib/db/supabase/service-client";
import { env } from "@/lib/env";
import { optOutTarget } from "@/lib/jobs/opt-out-core";

export const metadata: Metadata = {
  title: "Odhlášení ze zpráv",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Public opt-out page behind the link in every SMS (spec §16): the shop's
 * name and one button. Opening the page changes nothing; only the button
 * (POST) opts the number out for this shop.
 */
export default async function OptOutPage(props: PageProps<"/o/[token]">) {
  const { token } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  const target = await optOutTarget(createServiceClient(), token);
  if (!target) notFound();
  const done = target.alreadyOptedOut || (await props.searchParams).hotovo === "1";
  const t = await getTranslations("optOut");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center shadow-sm">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted">{target.shopName}</p>
        {done ? (
          <div className="mt-4 space-y-3" data-testid="opt-out-done">
            <CheckCircle2 className="mx-auto size-10 text-accent" aria-hidden />
            <h1 className="text-lg font-semibold text-ink">{t("doneTitle")}</h1>
            <p className="text-sm text-ink-2">{t("doneText", { shop: target.shopName })}</p>
          </div>
        ) : (
          <form action={optOutAction} className="mt-4 space-y-4">
            <h1 className="text-lg font-semibold text-ink">{t("title")}</h1>
            <p className="text-sm text-ink-2">{t("text", { shop: target.shopName })}</p>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" variant="default" size="lg" className="w-full">
              {t("button")}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
