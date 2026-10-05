import { useTranslations } from "next-intl";
import { isDemo } from "@/lib/env";
import { cn } from "@/lib/utils";

/** Small "Demo" marker next to money figures shown to shop owners. */
export function DemoTag({ className }: { className?: string }) {
  const t = useTranslations("demo");
  if (!isDemo) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-dashed border-line-strong px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted",
        className,
      )}
    >
      {t("tag")}
    </span>
  );
}

/** Company name with a "(demo)" marker. */
export function CompanyName({ name, className }: { name: string; className?: string }) {
  const t = useTranslations("demo");
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span>{name}</span>
      {isDemo && <span className="text-[0.75em] font-normal text-faint">({t("companyTag")})</span>}
    </span>
  );
}
