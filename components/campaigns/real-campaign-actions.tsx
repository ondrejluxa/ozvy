"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/inputs";
import {
  approveCampaignAction,
  cancelCampaignAction,
  deleteDraftAction,
  rejectCampaignAction,
  submitCampaignAction,
} from "@/lib/actions/real-campaigns";
import type { CampaignStatus } from "@/lib/db/types";

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

/** Operator actions on one campaign (spec §12 status machine). */
export function OperatorCampaignActions({
  companyId,
  campaignId,
  status,
  requiresClientApproval,
  basePath,
}: {
  companyId: string;
  campaignId: string;
  status: CampaignStatus;
  requiresClientApproval: boolean;
  basePath: string;
}) {
  const t = useTranslations("campaignBuilder");
  const router = useRouter();
  const { pending, call } = useCall();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const ids = { companyId, campaignId };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={`${basePath}/${campaignId}/edit`}>{t("edit")}</Link>
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={pending}
            onClick={() =>
              call(() => submitCampaignAction(ids), requiresClientApproval ? t("sentForApproval") : t("scheduled"))
            }
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {requiresClientApproval ? t("submitForApproval") : t("schedule")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              call(
                () => deleteDraftAction(ids),
                t("deleted"),
                () => router.push(basePath),
              )
            }
          >
            {t("deleteDraft")}
          </Button>
        </>
      )}
      {status === "scheduled" &&
        (confirmCancel ? (
          <>
            <span className="text-[13px] text-ink-2">{t("cancelConfirm")}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => call(() => cancelCampaignAction(ids), t("cancelled"))}
            >
              {t("cancelYes")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>
              {t("cancelNo")}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>
            {t("cancel")}
          </Button>
        ))}
    </div>
  );
}

/** The shop owner's decision on a waiting campaign (spec §6 F4): approve, or return with a comment. */
export function ApprovalPanel({ companyId, campaignId }: { companyId: string; campaignId: string }) {
  const t = useTranslations("campaignApproval");
  const { pending, call } = useCall();
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");
  const ids = { companyId, campaignId };

  return (
    <div className="space-y-3 rounded-lg border border-warn-line bg-warn-soft p-4" data-testid="approval-panel">
      <p className="text-sm font-medium text-ink">{t("question")}</p>
      {returning ? (
        <div className="space-y-2">
          <Label htmlFor="approval-comment">{t("comment")}</Label>
          <Textarea
            id="approval-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={pending || !comment.trim()}
              onClick={() => call(() => rejectCampaignAction({ ...ids, comment }), t("returned"))}
            >
              {t("sendBack")}
            </Button>
            <Button variant="ghost" onClick={() => setReturning(false)}>
              {t("back")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="accent"
            disabled={pending}
            onClick={() => call(() => approveCampaignAction(ids), t("approved"))}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {t("approve")}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => setReturning(true)}>
            {t("return")}
          </Button>
        </div>
      )}
    </div>
  );
}
