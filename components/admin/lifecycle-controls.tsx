"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/inputs";
import { recomputeLifecycleAction, setServiceCategoryAction } from "@/lib/actions/lifecycle";
import { SERVICE_CATEGORIES } from "@/lib/domain/service-labels";

/** "Přepočítat teď": queue a lifecycle recompute for one company, then refresh. */
export function RecomputeButton({ companyId }: { companyId: string }) {
  const t = useTranslations("lifecycle");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await recomputeLifecycleAction({ companyId });
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
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
      {t("recompute")}
    </Button>
  );
}

/** Category picker for one work description; saving re-categorises its visits. */
export function ServiceCategorySelect({
  companyId,
  label,
  example,
  category,
}: {
  companyId: string;
  label: string;
  example: string;
  category: string;
}) {
  const t = useTranslations("services");
  const tCategory = useTranslations("category");
  const tErrors = useTranslations("errors");
  const [value, setValue] = useState(category);
  const [pending, startTransition] = useTransition();

  const change = (next: string) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await setServiceCategoryAction({ companyId, label, category: next });
      if (!res.ok) {
        setValue(previous);
        toast.error(tErrors(res.error.code));
        return;
      }
      toast.success(t("saved", { label: example, count: res.data.visits }));
    });
  };

  return (
    <Select
      aria-label={t("categoryFor", { label: example })}
      value={value}
      disabled={pending}
      onChange={(e) => change(e.target.value)}
      className="w-48"
    >
      {SERVICE_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {tCategory(c)}
        </option>
      ))}
    </Select>
  );
}
