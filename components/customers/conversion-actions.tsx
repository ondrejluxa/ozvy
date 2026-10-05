"use client";

import { Check, PhoneCall, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/inputs";
import { markBookedAction, markCompletedAction } from "@/lib/actions/campaigns";
import { openClientViewAction } from "@/lib/actions/demo";
import type { ConversionStage } from "@/lib/db/types";
import { formatCZK, toMinor } from "@/lib/domain/money";

/**
 * Conversion pipeline buttons (spec §6 F5): "Objednal se" → "Dokončeno" with
 * the job value. Holdout returns are recorded but never counted.
 */
export function ConversionActions({
  companyId,
  enrollmentId,
  stage,
  isHoldout,
  customerName,
  campaignName,
  revenueMinor,
  compact = false,
}: {
  companyId: string;
  enrollmentId: string;
  stage: ConversionStage;
  isHoldout: boolean;
  customerName: string;
  campaignName: string;
  revenueMinor: number | null;
  compact?: boolean;
}) {
  const t = useTranslations("conversion");
  const tErrors = useTranslations("errors");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(revenueMinor ? String(revenueMinor / 100) : "");
  const [pending, startTransition] = useTransition();

  const parsed = Number(amount.replace(/\s/g, "").replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 500_000;

  const book = () =>
    startTransition(async () => {
      const res = await markBookedAction({ companyId, enrollmentId });
      if (res.ok) toast.success(t("bookedToast", { customer: customerName }));
      else toast.error(tErrors(res.error.code));
    });

  const complete = () =>
    startTransition(async () => {
      const czk = Math.round(parsed);
      const res = await markCompletedAction({ companyId, enrollmentId, revenueCzk: czk });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      setOpen(false);
      if (isHoldout) {
        toast.success(t("savedHoldout"));
      } else {
        toast.success(t("saved", { amount: formatCZK(toMinor(czk)) }), {
          action: { label: t("viewClient"), onClick: () => startTransition(() => openClientViewAction(companyId)) },
          duration: 8000,
        });
      }
    });

  if (stage === "lost" || stage === "opted_out") return null;
  const size = compact ? "sm" : "md";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {stage === "contacted" && (
        <Button variant="outline" size={size} onClick={book} disabled={pending}>
          <PhoneCall aria-hidden />
          {t("booked")}
        </Button>
      )}
      {stage !== "completed" ? (
        <Button variant="accent" size={size} onClick={() => setOpen(true)} disabled={pending}>
          <Check aria-hidden />
          {t("completed")}
        </Button>
      ) : (
        <Button variant="ghost" size={size} onClick={() => setOpen(true)} disabled={pending}>
          <Pencil aria-hidden />
          {t("edit")}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t("cancel")}>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("dialogDescription", { customer: customerName, campaign: campaignName })}
          </DialogDescription>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) complete();
            }}
          >
            {isHoldout && <p className="rounded-md bg-warn-soft px-3 py-2 text-[13px] text-warn">{t("holdoutNote")}</p>}
            <div className="space-y-1.5">
              <Label htmlFor={`amount-${enrollmentId}`}>{t("amount")}</Label>
              <Input
                id={`amount-${enrollmentId}`}
                inputMode="numeric"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="6 800"
                className="tnum h-11 text-lg"
              />
              {amount && !valid && <p className="text-[12px] text-danger">{t("invalidAmount")}</p>}
              {valid && parsed > 200_000 && <p className="text-[12px] text-warn">{t("highValue")}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="accent" disabled={!valid || pending}>
                {pending ? t("saving") : t("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
