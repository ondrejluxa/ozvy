"use client";

import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/inputs";
import {
  resetBreakerAction,
  resolveStuckMessageAction,
  runQueueNowAction,
  setKillSwitchAction,
} from "@/lib/actions/sending";

type Result = { ok: true } | { ok: false; error: { code: string } };

function useCall() {
  const tErrors = useTranslations("errors");
  const [pending, start] = useTransition();
  const call = (fn: () => Promise<Result>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      toast.success(success);
      after?.();
    });
  return { pending, call };
}

/** Global kill switch (spec §20): stops every start and every send until switched back. */
export function KillSwitch({ paused }: { paused: boolean }) {
  const t = useTranslations("system");
  const { pending, call } = useCall();
  const [reason, setReason] = useState("");
  if (paused) {
    return (
      <Button
        variant="accent"
        disabled={pending}
        onClick={() => call(() => setKillSwitchAction({ paused: false }), t("resumedToast"))}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {t("resumeAll")}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1 space-y-1.5">
        <Label htmlFor="kill-reason">{t("reason")}</Label>
        <Input id="kill-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </div>
      <Button
        variant="danger"
        disabled={pending || !reason.trim()}
        onClick={() => call(() => setKillSwitchAction({ paused: true, reason: reason.trim() }), t("pausedToast"))}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {t("pauseAll")}
      </Button>
    </div>
  );
}

/** Ends the breaker's pause: the next tick sends one probe message (spec §24). */
export function ResetBreakerButton() {
  const t = useTranslations("system");
  const { pending, call } = useCall();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => call(() => resetBreakerAction(), t("breakerResetToast"))}
    >
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {t("breakerReset")}
    </Button>
  );
}

/** Runs one messaging tick now (locally there is no cron). */
export function RunQueueButton() {
  const t = useTranslations("system");
  const router = useRouter();
  const { pending, call } = useCall();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        call(
          () => runQueueNowAction(),
          t("queueToast"),
          () => setTimeout(() => router.refresh(), 2_500),
        )
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
      {t("runQueue")}
    </Button>
  );
}

/** Manual review of a message stuck in 'sending' (spec §16): never resent automatically. */
export function ReviewButtons({ messageId }: { messageId: string }) {
  const t = useTranslations("system");
  const { pending, call } = useCall();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => call(() => resolveStuckMessageAction({ messageId, outcome: "sent" }), t("resolvedToast"))}
      >
        {t("markSent")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => call(() => resolveStuckMessageAction({ messageId, outcome: "failed" }), t("resolvedToast"))}
      >
        {t("markFailed")}
      </Button>
    </div>
  );
}
