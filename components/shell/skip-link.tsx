import { getTranslations } from "next-intl/server";

/** First focusable element: jumps keyboard users past the navigation (WCAG 2.4.1). */
export async function SkipLink() {
  const t = await getTranslations("nav");
  return (
    <a
      href="#obsah"
      className="sr-only z-50 rounded-md bg-ink px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
    >
      {t("skipToContent")}
    </a>
  );
}
