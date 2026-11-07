"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Result = { ok: true } | { ok: false; error: { code: string } };

/** Runs a server action, toasts the outcome (spec §24: toast for action results). */
export function useActionCall() {
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

/**
 * A button that asks before it acts. Used for anything hard to undo
 * (removing a user, erasing a customer, rejecting a request).
 */
export function ConfirmAction({
  label,
  title,
  description,
  confirmLabel,
  success,
  action,
  variant = "outline",
  confirmVariant = "danger",
  size = "sm",
  testId,
  children,
}: {
  label: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  success: string;
  action: () => Promise<Result>;
  variant?: ButtonProps["variant"];
  confirmVariant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  testId?: string;
  children?: ReactNode;
}) {
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const { pending, call } = useActionCall();
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} data-testid={testId}>
        {children}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent closeLabel={tCommon("close")}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant={confirmVariant}
              size="sm"
              disabled={pending}
              onClick={() => call(action, success, () => setOpen(false))}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
