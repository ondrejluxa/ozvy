import { FlaskConical } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** Permanent strip on every page so demo numbers are never mistaken for real results. */
export async function DemoBar() {
  const t = await getTranslations("demo");
  return (
    <div
      role="note"
      className="sticky top-0 z-40 flex min-h-8 items-center justify-center gap-2 bg-ink px-4 py-1.5 text-center text-[12px] leading-4 text-white"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span className="font-semibold uppercase tracking-wide">{t("bar")}</span>
      <span className="hidden text-white/75 sm:inline">· {t("barDetail")}</span>
    </div>
  );
}
