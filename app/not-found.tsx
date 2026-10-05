import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-xl font-semibold text-ink">{t("pageNotFound")}</h1>
      <p className="mt-2 text-sm text-muted">{t("pageNotFoundHint")}</p>
      <Button asChild className="mt-6">
        <Link href="/admin">{t("backHome")}</Link>
      </Button>
    </main>
  );
}
