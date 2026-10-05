import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MfaEnroll, MfaVerify } from "@/components/auth/forms";
import { safeNextPath } from "@/lib/auth/access";
import { getSessionInfo } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/supabase/server-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.mfa");
  return { title: t("title") };
}

/** TOTP enrolment or verification; platform admins cannot reach /admin without it (spec §20). */
export default async function MfaPage(props: PageProps<"/mfa">) {
  const { next } = await props.searchParams;
  const nextPath = safeNextPath(typeof next === "string" ? next : null, "");
  const session = await getSessionInfo();
  if (!session) redirect(`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`);
  if (session.aal === "aal2") redirect(nextPath || (session.isPlatformAdmin ? "/admin" : "/app"));

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).find((f) => f.status === "verified");
  return verified ? <MfaVerify factorId={verified.id} next={nextPath} /> : <MfaEnroll next={nextPath} />;
}
