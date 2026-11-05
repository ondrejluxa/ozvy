"use client";

import { Check, PhoneCall, Pencil, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/inputs";
import { recordConversionAction } from "@/lib/actions/conversions";
import {
  allowedActions,
  attributionWindow,
  HIGH_JOB_VALUE_CZK,
  parseJobValue,
  type EnrollmentView,
} from "@/lib/domain/attribution/conversions";
import { formatDate, pragueParts, pragueTime } from "@/lib/domain/dates";
import { formatCZK } from "@/lib/domain/money";

/** "2026-11-05" for an instant, in Prague time. */
function dateInput(d: Date): string {
  const p = pragueParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Conversion pipeline buttons (spec §6 F5, §14) on real data: "Objednal se",
 * "Dokončeno" with the job value and date, "Upravit tržbu", "Vrátit zpět".
 * Holdout returns are recorded but never counted as recovered revenue.
 */
export function ConversionButtons({
  companyId,
  enrollment,
  customerName,
  campaignName,
  revenueMinor,
  completedAt,
  now,
  compact = false,
}: {
  companyId: string;
  enrollment: EnrollmentView;
  customerName: string;
  campaignName: string;
  revenueMinor: number | null;
  completedAt: string | null;
  now: string;
  compact?: boolean;
}) {
  const t = useTranslations("conversion");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"complete" | "edit" | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const nowDate = useMemo(() => new Date(now), [now]);
  const win = attributionWindow(enrollment);
  const [amount, setAmount] = useState(revenueMinor ? String(revenueMinor / 100) : "");
  const [day, setDay] = useState(dateInput(completedAt ? new Date(completedAt) : nowDate));
  const actions = allowedActions(enrollment, nowDate);
  const minor = parseJobValue(amount);
  const size = compact ? "sm" : "md";

  /** Noon of the chosen day, kept inside the window and not in the future. */
  const atFor = (value: string): string => {
    const [y, m, d] = value.split("-").map(Number);
    let at = pragueTime(y, m, d, 12, 0);
    if (dateInput(at) === dateInput(nowDate) && at > nowDate) at = nowDate;
    if (win.start && at < win.start) at = win.start;
    if (win.end && at > win.end) at = win.end;
    return at.toISOString();
  };

  const call = (action: "book" | "complete" | "edit" | "revert", extra: { revenueMinor?: number; at?: string } = {}) =>
    startTransition(async () => {
      const res = await recordConversionAction({ companyId, enrollmentId: enrollment.id, action, ...extra });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      setDialog(null);
      setConfirmRevert(false);
      if (action === "book") toast.success(t("bookedToast", { customer: customerName }));
      else if (action === "revert") toast.success(t("revertedToast"));
      else if (enrollment.isHoldout) toast.success(t("savedHoldout"));
      else toast.success(t("savedReal", { amount: formatCZK(extra.revenueMinor ?? 0) }));
    });

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5" data-testid="conversion-buttons">
      {actions.includes("book") && (
        <Button variant="outline" size={size} disabled={pending} onClick={() => call("book")}>
          <PhoneCall aria-hidden />
          {t("booked")}
        </Button>
      )}
      {actions.includes("complete") && (
        <Button variant="accent" size={size} disabled={pending} onClick={() => setDialog("complete")}>
          <Check aria-hidden />
          {t("completed")}
        </Button>
      )}
      {actions.includes("edit") && (
        <Button variant="ghost" size={size} disabled={pending} onClick={() => setDialog("edit")}>
          <Pencil aria-hidden />
          {t("edit")}
        </Button>
      )}
      {actions.includes("revert") &&
        (confirmRevert ? (
          <>
            <Button variant="outline" size={size} disabled={pending} onClick={() => call("revert")}>
              {t("revertYes")}
            </Button>
            <Button variant="ghost" size={size} onClick={() => setConfirmRevert(false)}>
              {t("cancel")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" size={size} disabled={pending} onClick={() => setConfirmRevert(true)}>
            <Undo2 aria-hidden />
            {t("revert")}
          </Button>
        ))}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent closeLabel={t("cancel")}>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("dialogDescription", { customer: customerName, campaign: campaignName })}
          </DialogDescription>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (minor && dialog) call(dialog, { revenueMinor: minor, at: atFor(day) });
            }}
          >
            {enrollment.isHoldout && (
              <p className="rounded-md bg-info-soft px-3 py-2 text-[13px] text-info">{t("holdoutNote")}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`amount-${enrollment.id}`}>{t("amount")}</Label>
              <Input
                id={`amount-${enrollment.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
              {amount && !minor && <p className="text-[12px] text-danger">{t("invalidAmount")}</p>}
              {minor !== null && minor > HIGH_JOB_VALUE_CZK * 100 && (
                <p className="text-[12px] text-warn">{t("highValue")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`day-${enrollment.id}`}>{t("date")}</Label>
              <Input
                id={`day-${enrollment.id}`}
                type="date"
                value={day}
                min={win.start ? dateInput(win.start) : undefined}
                max={dateInput(win.end && win.end < nowDate ? win.end : nowDate)}
                onChange={(e) => setDay(e.target.value)}
              />
              {win.end && <p className="text-[12px] text-muted">{t("windowHint", { date: formatDate(win.end) })}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="accent" disabled={pending || !minor}>
                {pending ? t("saving") : t("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
