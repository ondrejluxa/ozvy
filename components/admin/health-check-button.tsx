"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runHealthCheckNowAction } from "@/lib/actions/alerts";

/** Re-evaluates Attention Required now (locally there is no 15-minute cron). */
export function HealthCheckButton() {
  const t = useTranslations("alerts");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runHealthCheckNowAction();
          if (!res.ok) {
            toast.error(tErrors(res.error.code));
            return;
          }
          toast.success(t("checkQueued"));
          setTimeout(() => router.refresh(), 2_000);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
      {t("checkNow")}
    </Button>
  );
}
