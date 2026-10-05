import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/forms";
import { homePath, safeNextPath } from "@/lib/auth/access";
import { getSessionInfo } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("title") };
}

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  const nextPath = safeNextPath(typeof next === "string" ? next : null, "");
  const session = await getSessionInfo();
  if (session) redirect(nextPath || homePath(session));
  return <LoginForm next={nextPath} />;
}
