import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { UpdatePasswordForm } from "@/components/auth/forms";
import { getSessionInfo } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.update");
  return { title: t("title") };
}

/** Reached from the password-reset email (the link signs the user in first). */
export default async function UpdatePasswordPage() {
  if (!(await getSessionInfo())) redirect("/login");
  return <UpdatePasswordForm />;
}
