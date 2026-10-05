import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AcceptAsCurrentUser, AcceptInviteForm } from "@/components/auth/forms";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { loadInvitation } from "@/lib/auth/invitations";
import { getSessionInfo } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/domain/invitations";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.invite");
  return { title: t("title") };
}

export default async function AcceptInvitePage(props: PageProps<"/accept-invite">) {
  const { token } = await props.searchParams;
  const raw = typeof token === "string" ? token : null;
  const t = await getTranslations("auth.invite");
  const tRoles = await getTranslations("auth.userMenu.roles");
  const invitation = await loadInvitation(raw);
  const session = await getSessionInfo();

  const header = <h1 className="text-lg font-semibold text-ink">{t("title")}</h1>;
  if (!invitation || invitation.state !== "valid") {
    const message = !invitation ? t("invalid") : invitation.state === "expired" ? t("expired") : t("accepted");
    return (
      <div className="space-y-4">
        {header}
        <p className="text-sm text-ink-2">{message}</p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">{t("signIn")}</Link>
        </Button>
      </div>
    );
  }

  const sameAccount = session && normalizeEmail(session.email ?? "") === normalizeEmail(invitation.email);
  return (
    <div className="space-y-4">
      {header}
      <p className="text-sm text-ink-2">
        {t("description", { company: invitation.companyName, role: tRoles(invitation.role).toLowerCase() })}
      </p>
      {!session && <AcceptInviteForm token={raw!} email={invitation.email} />}
      {sameAccount && (
        <>
          <p className="text-[13px] text-muted">{t("signedInAs", { email: session.email ?? "" })}</p>
          <AcceptAsCurrentUser token={raw!} />
        </>
      )}
      {session && !sameAccount && (
        <>
          <p className="rounded-md bg-warn-soft px-3 py-2 text-[13px] text-warn">{t("wrongAccount")}</p>
          <SignOutButton label={t("signOut")} variant="outline" />
        </>
      )}
    </div>
  );
}
