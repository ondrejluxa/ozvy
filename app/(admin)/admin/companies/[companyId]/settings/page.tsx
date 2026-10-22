import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CompanyProfileForm, CompanySettingsForm, DpaForm, SendingSwitch } from "@/components/admin/company-forms";
import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import { profileDefaults, settingsDefaults } from "@/components/admin/real-company";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageContext } from "@/lib/auth/context";
import { getCompanyRecord, hasCompletedImport, listCompanyUsers } from "@/lib/db/supabase/companies";
import { formatDate } from "@/lib/domain/dates";
import { sendingBlockers } from "@/lib/domain/dpa";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("company.tabs");
  return { title: t("settings") };
}

/** Company settings for the operator (spec §6 F1 steps 1–4, §40.5). */
export default async function CompanySettingsPage(props: PageProps<"/admin/companies/[companyId]/settings">) {
  const { companyId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  await requirePageContext({ permission: "admin.access" }, `/admin/companies/${companyId}/settings`);
  const company = await getCompanyRecord(companyId);
  if (!company) notFound();
  const users = await listCompanyUsers(companyId);
  const t = await getTranslations("companyForm");
  const tRoles = await getTranslations("realData.invite.roles");
  const blocker =
    sendingBlockers({
      dpaSignedAt: company.dpa_signed_at,
      status: company.status,
      hasCompletedImport: await hasCompletedImport(companyId),
    })[0] ?? null;

  return (
    <div className="grid max-w-3xl grid-cols-1 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("sending.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SendingSwitch companyId={companyId} enabled={company.sending_enabled} blocker={blocker} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dpa.title")}</CardTitle>
          {company.dpa_signed_at && (
            <Badge tone="accent">{t("dpa.signed", { date: formatDate(company.dpa_signed_at) })}</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[13px] text-muted">{t("dpa.description")}</p>
          {company.dpa_document_path && (
            <Button asChild variant="outline" size="sm">
              {/* A route handler, not a page: plain link so the browser follows the redirect. */}
              <a href={`/admin/companies/${companyId}/dpa`}>{t("dpa.download")}</a>
            </Button>
          )}
          {company.dpa_signed_at && <p className="text-[13px] font-medium text-ink-2">{t("dpa.replace")}</p>}
          <DpaForm companyId={companyId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sections.users")}</CardTitle>
          <InviteUserDialog companyId={companyId} companyName={company.name} />
        </CardHeader>
        <CardContent>
          {users.members.length + users.pending.length === 0 ? (
            <p className="text-sm text-muted">{t("users.empty")}</p>
          ) : (
            <ul className="divide-y divide-line text-sm" data-testid="company-users">
              {users.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                  <span className="font-medium text-ink">{m.fullName ?? t("users.noName")}</span>
                  <span className="text-[13px] text-muted">
                    {tRoles(m.role)} · {t("users.since", { date: formatDate(m.since) })}
                  </span>
                </li>
              ))}
              {users.pending.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                  <span className="break-all text-ink-2">{i.email}</span>
                  <span className="text-[13px] text-muted">
                    {tRoles(i.role)} · {t("users.pending", { date: formatDate(i.expiresAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sections.profile")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyProfileForm companyId={companyId} defaults={profileDefaults(company)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sections.settings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[13px] text-muted">{t("sections.settingsDescription")}</p>
          <CompanySettingsForm companyId={companyId} defaults={settingsDefaults(company.settings)} />
        </CardContent>
      </Card>
    </div>
  );
}
