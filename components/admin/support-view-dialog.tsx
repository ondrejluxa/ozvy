"use client";

import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/inputs";
import { startSupportViewAction } from "@/lib/actions/support-view";
import { SUPPORT_REASONS } from "@/lib/domain/support-view";

/** "Otevřít účet klienta": asks for a reason, then opens the shop's client UI read-only (spec §10). */
export function SupportViewDialog({ companyId, companyName }: { companyId: string; companyName: string }) {
  const t = useTranslations("supportView");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Eye aria-hidden />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("cancel")}>
        <DialogTitle>{t("open")}</DialogTitle>
        <DialogDescription>{t("dialogDescription", { company: companyName })}</DialogDescription>
        <form action={startSupportViewAction} className="mt-4 space-y-4">
          <input type="hidden" name="companyId" value={companyId} />
          <div className="space-y-1.5">
            <Label htmlFor="support-reason">{t("reason")}</Label>
            <Select id="support-reason" name="reason" defaultValue="client_request">
              {SUPPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`reasons.${r}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="support-note">{t("note")}</Label>
            <Input id="support-note" name="note" maxLength={300} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="accent">
              {t("start")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
