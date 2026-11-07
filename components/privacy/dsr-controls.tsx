"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmAction, useActionCall } from "@/components/common/confirm-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/inputs";
import {
  completeDataSubjectRequestAction,
  createDataSubjectRequestAction,
  keepFlaggedCustomersAction,
  rejectDataSubjectRequestAction,
} from "@/lib/actions/privacy";
import { DSR_TYPES, type DsrType } from "@/lib/domain/privacy";

/** The operator records a request received by e-mail, phone or letter (any type). */
export function RecordRequestButton({ companyId, customerId }: { companyId: string; customerId: string }) {
  const t = useTranslations("dsr");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DsrType>("access");
  const { pending, call } = useActionCall();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("record")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent closeLabel={tCommon("close")}>
          <DialogTitle>{t("recordTitle")}</DialogTitle>
          <DialogDescription>{t("recordDescription")}</DialogDescription>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="dsr-type">{t("type")}</Label>
            <Select id="dsr-type" value={type} onChange={(e) => setType(e.target.value as DsrType)}>
              {DSR_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`types.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={pending}
              onClick={() =>
                call(
                  () => createDataSubjectRequestAction({ companyId, customerId, type }),
                  t("recorded"),
                  () => setOpen(false),
                )
              }
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {t("record")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A managed shop owner asks the operator for an export or an erasure (spec §20). */
export function OwnerRequestButtons({ companyId, customerId }: { companyId: string; customerId: string }) {
  const t = useTranslations("dsr");
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmAction
        label={t("requestAccess")}
        title={t("requestAccessTitle")}
        description={t("requestAccessText")}
        confirmLabel={t("send")}
        confirmVariant="default"
        success={t("requested")}
        action={() => createDataSubjectRequestAction({ companyId, customerId, type: "access" })}
      />
      <ConfirmAction
        label={t("requestErasure")}
        title={t("requestErasureTitle")}
        description={t("requestErasureText")}
        confirmLabel={t("send")}
        success={t("requested")}
        action={() => createDataSubjectRequestAction({ companyId, customerId, type: "erasure" })}
        testId="request-erasure"
      />
    </div>
  );
}

export function RequestDecision({
  companyId,
  requestId,
  type,
}: {
  companyId: string;
  requestId: string;
  type: DsrType;
}) {
  const t = useTranslations("dsr");
  const text = {
    access: t("completeAccess"),
    erasure: t("completeErasure"),
    rectification: t("completeRectification"),
    objection: t("completeObjection"),
  }[type];
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ConfirmAction
        label={t("complete")}
        title={t("completeTitle")}
        description={text}
        confirmLabel={type === "erasure" ? t("eraseConfirm") : t("completeConfirm")}
        confirmVariant={type === "erasure" ? "danger" : "default"}
        success={t("completed")}
        action={() => completeDataSubjectRequestAction({ companyId, requestId })}
        testId={`complete-${type}`}
      />
      <ConfirmAction
        label={t("reject")}
        title={t("rejectTitle")}
        description={t("rejectText")}
        confirmLabel={t("reject")}
        success={t("rejected")}
        action={() => rejectDataSubjectRequestAction({ companyId, requestId })}
        variant="ghost"
      />
    </div>
  );
}

export function KeepFlaggedButton({ companyId }: { companyId: string }) {
  const t = useTranslations("retention");
  return (
    <ConfirmAction
      label={t("keep")}
      title={t("keepTitle")}
      description={t("keepText")}
      confirmLabel={t("keepConfirm")}
      confirmVariant="default"
      success={t("kept")}
      action={() => keepFlaggedCustomersAction({ companyId })}
    />
  );
}
