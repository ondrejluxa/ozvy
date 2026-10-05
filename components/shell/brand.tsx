import { useTranslations } from "next-intl";
import { isDemo } from "@/lib/env";

export function ProductBrand({ product, area }: { product: string; area: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid size-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-white"
        aria-hidden
      >
        N
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-ink">{product}</div>
        <div className="text-[11px] text-muted">{area}</div>
      </div>
    </div>
  );
}

export function ClientBrand({ name, city }: { name: string; city: string | null }) {
  const t = useTranslations("demo");
  const initials = name
    .replace(/s\.r\.o\.|a\.s\./g, "")
    .split(/\s+/)
    .filter((w) => /^\p{Lu}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className="grid size-7 shrink-0 place-items-center rounded-md bg-ink text-[11px] font-bold text-white"
        aria-hidden
      >
        {initials}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold text-ink">{name}</div>
        <div className="text-[11px] text-muted">
          {city}
          {isDemo && <> · {t("companyTag")}</>}
        </div>
      </div>
    </div>
  );
}
