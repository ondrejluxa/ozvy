import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";

export default async function ForbiddenPage() {
  const t = await getTranslations("auth.forbidden");
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">{t("title")}</h1>
      <p className="text-sm text-ink-2">{t("description")}</p>
      <Button asChild variant="outline" className="w-full">
        <Link href="/login">{t("home")}</Link>
      </Button>
      <SignOutButton label={t("signOut")} />
    </div>
  );
}
