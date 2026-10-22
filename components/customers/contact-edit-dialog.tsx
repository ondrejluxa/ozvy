"use client";

import { Loader2, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/inputs";
import { updateCustomerContactAction, type ContactFormState } from "@/lib/actions/customers";

const FIELDS = ["first_name", "last_name", "phone", "email"] as const;

/** Edit a customer's contact details (spec §20 customers.edit_contact). */
export function ContactEditDialog({
  companyId,
  customerId,
  defaults,
}: {
  companyId: string;
  customerId: string;
  defaults: Record<string, string>;
}) {
  const t = useTranslations("customer.edit");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateCustomerContactAction, {} as ContactFormState);

  useEffect(() => {
    if (!state.done) return;
    toast.success(t("saved"));
    setOpen(false); // eslint-disable-line react-hooks/set-state-in-effect -- close after a successful save
  }, [state, t]);

  const value = (name: string) => state.values?.[name] ?? defaults[name] ?? "";
  const error = (name: string) => state.fieldErrors?.[name];

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil aria-hidden />
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t("cancel")}>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
          <form action={action} className="mt-4 space-y-3" noValidate>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="customerId" value={customerId} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FIELDS.map((name) => (
                <div key={name} className="space-y-1.5">
                  <Label htmlFor={`contact-${name}`}>{t(`fields.${name}`)}</Label>
                  <Input
                    id={`contact-${name}`}
                    name={name}
                    type={name === "email" ? "email" : name === "phone" ? "tel" : "text"}
                    defaultValue={value(name)}
                    aria-invalid={error(name) ? true : undefined}
                  />
                  {error(name) && <p className="text-[12px] text-danger">{t(`errors.${error(name)}`)}</p>}
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-notes">{t("fields.notes")}</Label>
              <Textarea id="contact-notes" name="notes" defaultValue={value("notes")} maxLength={2000} />
            </div>
            <p className="text-[12px] text-muted">{t("legalNote")}</p>
            {state.error && (
              <p role="alert" className="text-[13px] text-danger">
                {t(`errors.${state.error}`)}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="accent" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {t("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
