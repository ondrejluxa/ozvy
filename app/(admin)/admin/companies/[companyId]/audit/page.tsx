import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuditLog } from "@/components/audit/audit-log";
import { requirePageContext } from "@/lib/auth/context";
import { listAuditLogs } from "@/lib/db/supabase/audit";
import { parseAuditFilter } from "@/lib/domain/audit-filters";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("company.tabs");
  return { title: t("audit") };
}

/** The audit log of one shop (spec §23: per-company tab, filter by action and date). */
export default async function CompanyAuditPage(props: PageProps<"/admin/companies/[companyId]/audit">) {
  const { companyId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  const base = `/admin/companies/${companyId}/audit`;
  await requirePageContext({ permission: "admin.access" }, base);
  const t = await getTranslations("auditLog");
  const filter = parseAuditFilter(await props.searchParams);
  const { rows, hasMore } = await listAuditLogs({ companyId }, filter);
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">{t("description")}</p>
      <AuditLog rows={rows} hasMore={hasMore} filter={filter} basePath={base} />
    </div>
  );
}
