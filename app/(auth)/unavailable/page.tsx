import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

/** Shown with DATA_SOURCE=supabase for screens that still only work on demo data. */
export default async function UnavailablePage() {
  const t = await getTranslations("auth.unavailable");
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">{t("title")}</h1>
      <p className="text-sm text-ink-2">{t("description")}</p>
      <Button asChild variant="outline" className="w-full">
        <Link href="/login">{t("back")}</Link>
      </Button>
    </div>
  );
}
