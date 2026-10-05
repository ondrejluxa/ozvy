"use client";

import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/inputs";
import { createInvitationAction } from "@/lib/actions/invitations";

/** Invite a shop owner or manager to a company (spec §6 F1 step 3, §20 users.invite). */
export function InviteUserDialog({ companyId, companyName }: { companyId: string; companyName: string }) {
  const t = useTranslations("realData.invite");
  const tErrors = useTranslations("errors");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"shop_owner" | "shop_manager">("shop_owner");

  const submit = () =>
    startTransition(async () => {
      const res = await createInvitationAction({ companyId, email, role });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      toast.success(t("sent"));
      setOpen(false);
      setEmail("");
    });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden />
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t("cancel")}>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { company: companyName })}</DialogDescription>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`invite-email-${companyId}`}>{t("email")}</Label>
              <Input
                id={`invite-email-${companyId}`}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invite-role-${companyId}`}>{t("role")}</Label>
              <Select
                id={`invite-role-${companyId}`}
                value={role}
                onChange={(e) => setRole(e.target.value as "shop_owner" | "shop_manager")}
              >
                <option value="shop_owner">{t("roles.shop_owner")}</option>
                <option value="shop_manager">{t("roles.shop_manager")}</option>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="accent" disabled={pending || !email}>
                {pending ? t("sending") : t("submit")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
