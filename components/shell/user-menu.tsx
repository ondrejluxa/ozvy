import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import type { SessionInfo } from "@/lib/auth/access";

/** Sidebar footer for signed-in users: who is signed in, in which role, and sign-out. */
export async function UserMenu({ session, companyId }: { session: SessionInfo; companyId?: string }) {
  const t = await getTranslations("auth.userMenu");
  const membership = companyId ? session.memberships.find((m) => m.companyId === companyId) : undefined;
  const role = session.isPlatformAdmin && !membership ? t("operator") : membership ? t(`roles.${membership.role}`) : "";
  return (
    <div className="space-y-2">
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-medium text-ink">{session.fullName ?? session.email}</div>
        <div className="truncate text-[11px] text-muted">
          {role}
          {session.fullName && session.email ? ` · ${session.email}` : ""}
        </div>
      </div>
      <SignOutButton label={t("signOut")} />
    </div>
  );
}
