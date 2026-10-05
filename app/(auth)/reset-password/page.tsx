import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResetRequestForm } from "@/components/auth/forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  return { title: t("title") };
}

export default function ResetPasswordPage() {
  return <ResetRequestForm />;
}
