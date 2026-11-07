import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ShopContactForm } from "@/components/admin/company-forms";
import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import { profileDefaults } from "@/components/admin/real-company";
import { AuditLog } from "@/components/audit/audit-log";
import { DsrTable, RetentionCard } from "@/components/privacy/privacy-panels";
import { MemberList } from "@/components/settings/members";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireClientCompany } from "@/lib/auth/client-company";
import { requireContext } from "@/lib/auth/context";
import { listAuditLogs } from "@/lib/db/supabase/audit";
import { getCompanyRecord, listCompanyUsers } from "@/lib/db/supabase/companies";
import { getRetentionSummary, listDataSubjectRequests } from "@/lib/db/supabase/privacy";
import { parseAuditFilter } from "@/lib/domain/audit-filters";
import { formatDate } from "@/lib/domain/dates";
import type { Permission } from "@/lib/auth/permissions";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("clientSettings");
  return { title: t("title") };
}

const TABS = ["profile", "users", "data", "history"] as const;
type Tab = (typeof TABS)[number];

/**
 * Client settings (spec §8 "Nastavení"): Profil servisu, Uživatelé, Data a
 * soukromí, Historie změn. Owners edit; managers and the operator's support
 * view read. The "Oznámení" tab waits for the monthly results e-mail (Phase 2).
 */
export default async function ClientSettingsPage(props: PageProps<"/app/settings">) {
  if (env.DATA_SOURCE !== "supabase") notFound();
  const { session, membership } = await requireClientCompany("/app/settings");
  const companyId = membership.companyId;
  const sp = await props.searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "profile";

  const allowed = (permission: Permission) =>
    requireContext({ permission, companyId }, { read: true })
      .then(() => true)
      .catch(() => false);
  // The support view reads everything but changes nothing (spec §10).
  const writable = !membership.supportView;
  const isOwner = await allowed("settings.company");
  const canManageUsers = writable && (await allowed("users.invite"));

  const t = await getTranslations("clientSettings");
  const visibleTabs = TABS.filter((k) => isOwner || k === "profile" || k === "users");
  if (!visibleTabs.includes(tab)) notFound();
  const company = await getCompanyRecord(companyId);
  if (!company) notFound();

  return (
    <>
      <PageHeader title={t("title")} />
      <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--color-line)] sm:mx-0 sm:px-0">
        {visibleTabs.map((k) => (
          <Link
            key={k}
            href={k === "profile" ? "/app/settings" : `/app/settings?tab=${k}`}
            aria-current={tab === k ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm",
              tab === k ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>

      {tab === "profile" && (
        <div className="max-w-3xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("tabs.profile")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-[13px] text-muted">
                {isOwner && writable ? t("profileOperator") : t("profileReadOnly")}
              </p>
              {isOwner && writable ? (
                <ShopContactForm companyId={companyId} defaults={profileDefaults(company)} />
              ) : (
                <ProfileSummary company={company} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "users" && (
        <UsersTab
          companyId={companyId}
          companyName={company.name}
          canManage={canManageUsers}
          currentUserId={session.userId}
        />
      )}

      {tab === "data" && (
        <div className="max-w-4xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("dataTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-[13px] text-muted">{t("dataText")}</p>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium text-ink">{t("dpa")}:</span>
                {company.dpa_signed_at ? (
                  <>
                    <span className="text-ink-2">{t("dpaSigned", { date: formatDate(company.dpa_signed_at) })}</span>
                    {company.dpa_document_path && (
                      <Button asChild variant="outline" size="sm">
                        {/* A route handler: a plain link so the browser follows the redirect. */}
                        <a href="/app/settings/dpa">{t("dpaDownload")}</a>
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-warn">{t("dpaMissing")}</span>
                )}
              </div>
            </CardContent>
          </Card>
          <DataRequests companyId={companyId} />
          <RetentionCard summary={await getRetentionSummary(companyId)} companyId={companyId} canKeep={writable} />
        </div>
      )}

      {tab === "history" && <HistoryTab companyId={companyId} searchParams={sp} />}
    </>
  );
}

async function ProfileSummary({ company }: { company: NonNullable<Awaited<ReturnType<typeof getCompanyRecord>>> }) {
  const t = await getTranslations("companyForm");
  const tSettings = await getTranslations("clientSettings");
  const hours = (company.opening_hours as { note?: string } | null)?.note;
  const rows: [string, string | null][] = [
    [t("fields.name"), company.name],
    [t("fields.contact_person"), company.contact_person],
    [t("fields.phone"), company.phone],
    [t("fields.email"), company.email],
    [t("fields.city"), company.city],
    [t("fields.opening_hours"), hours ?? null],
    [tSettings("sender"), company.default_sender_name],
  ];
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[12px] text-muted">{label}</dt>
          <dd className="text-ink">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

async function UsersTab({
  companyId,
  companyName,
  canManage,
  currentUserId,
}: {
  companyId: string;
  companyName: string;
  canManage: boolean;
  currentUserId: string;
}) {
  const t = await getTranslations("clientSettings");
  const users = await listCompanyUsers(companyId);
  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("tabs.users")}</CardTitle>
          {canManage && <InviteUserDialog companyId={companyId} companyName={companyName} />}
        </CardHeader>
        <CardContent className="space-y-3">
          {!canManage && <p className="text-[13px] text-muted">{t("usersManaged")}</p>}
          <MemberList
            companyId={companyId}
            members={users.members}
            pending={canManage ? users.pending : []}
            canManage={canManage}
            currentUserId={currentUserId}
          />
          {users.members.length <= 1 && users.pending.length === 0 && (
            <p className="text-[13px] text-muted">{t("noUsers")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function DataRequests({ companyId }: { companyId: string }) {
  const t = await getTranslations("dsr");
  const rows = await listDataSubjectRequests(companyId);
  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold text-ink">{t("title")}</h2>
      <DsrTable
        rows={rows}
        companyId={companyId}
        customerHref={(id) => `/app/customers/${id}`}
        operator={false}
        now={new Date()}
        emptyText={t("emptyClient")}
      />
    </section>
  );
}

async function HistoryTab({
  companyId,
  searchParams,
}: {
  companyId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations("auditLog");
  const filter = parseAuditFilter(searchParams);
  const { rows, hasMore } = await listAuditLogs({ companyId }, filter);
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">{t("descriptionClient")}</p>
      <AuditLog
        rows={rows}
        hasMore={hasMore}
        filter={filter}
        basePath="/app/settings"
        hiddenParams={{ tab: "history" }}
        simplified
      />
    </div>
  );
}
