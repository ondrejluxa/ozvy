import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuditLog } from "@/components/audit/audit-log";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageContext } from "@/lib/auth/context";
import { listAuditLogs } from "@/lib/db/supabase/audit";
import { parseAuditFilter } from "@/lib/domain/audit-filters";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auditLog");
  return { title: t("systemTitle") };
}

/** The whole audit log, including sign-ins and events without a shop (spec §23). */
export default async function SystemAuditPage(props: PageProps<"/admin/system/audit">) {
  if (env.DATA_SOURCE !== "supabase") notFound();
  const base = "/admin/system/audit";
  await requirePageContext({ permission: "admin.access" }, base);
  const t = await getTranslations("auditLog");
  const tSystem = await getTranslations("system");
  const filter = parseAuditFilter(await props.searchParams);
  const { rows, hasMore } = await listAuditLogs({ all: true }, filter);
  return (
    <>
      <PageHeader
        title={t("systemTitle")}
        description={t("systemDescription")}
        back={{ href: "/admin/system", label: tSystem("title") }}
      />
      <AuditLog rows={rows} hasMore={hasMore} filter={filter} basePath={base} showShop />
    </>
  );
}
