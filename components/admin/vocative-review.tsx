"use client";

import { Check, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/inputs";
import { refreshVocativesAction, reviewVocativeAction } from "@/lib/actions/vocatives";
import { greetingFor, type Gender } from "@/lib/domain/messaging/vocative";

/** "Navrhnout oslovení": rules + AI batch for surnames without a vocative. */
export function RefreshVocativesButton({ companyId, missing }: { companyId: string; missing: number }) {
  const t = useTranslations("vocatives");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="accent"
      size="sm"
      disabled={pending || missing === 0}
      onClick={() =>
        startTransition(async () => {
          const res = await refreshVocativesAction({ companyId });
          if (!res.ok) {
            toast.error(tErrors(res.error.code));
            return;
          }
          toast.success(t("queued"));
          // Inline locally: the job finishes right after the response.
          setTimeout(() => router.refresh(), 2_500);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
      {t("refresh")}
    </Button>
  );
}

/** One surname to review: edit the vocative and gender, see the greeting, approve. */
export function VocativeReviewRow({
  companyId,
  id,
  surname,
  vocative,
  gender,
}: {
  companyId: string;
  id: string;
  surname: string;
  vocative: string;
  gender: Gender;
}) {
  const t = useTranslations("vocatives");
  const tErrors = useTranslations("errors");
  const [value, setValue] = useState(vocative);
  const [sex, setSex] = useState<Gender>(gender);
  const [pending, startTransition] = useTransition();
  const preview = greetingFor({ vocative: value.trim(), gender: sex, confidence: 1, reviewedAt: "now" });
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="vocative-review-row">
      <span className="w-36 font-medium text-ink">{surname}</span>
      <Input
        aria-label={t("vocativeFor", { surname })}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-40"
        maxLength={80}
      />
      <Select
        aria-label={t("genderFor", { surname })}
        value={sex}
        onChange={(e) => setSex(e.target.value as Gender)}
        className="w-36"
      >
        <option value="m">{t("gender.m")}</option>
        <option value="f">{t("gender.f")}</option>
        <option value="unknown">{t("gender.unknown")}</option>
      </Select>
      <span className="min-w-48 flex-1 text-[13px] text-ink-2">{preview}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || value.trim().length === 0}
        onClick={() =>
          startTransition(async () => {
            const res = await reviewVocativeAction({ companyId, id, vocative: value.trim(), gender: sex });
            if (!res.ok) {
              toast.error(tErrors(res.error.code));
              return;
            }
            toast.success(t("approved", { surname }));
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
        {t("approve")}
      </Button>
    </div>
  );
}
