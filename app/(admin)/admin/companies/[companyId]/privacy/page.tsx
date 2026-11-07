import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DsrTable, RetentionCard } from "@/components/privacy/privacy-panels";
import { requirePageContext } from "@/lib/auth/context";
import { getRetentionSummary, listDataSubjectRequests } from "@/lib/db/supabase/privacy";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("company.tabs");
  return { title: t("privacy") };
}

/** Data subject requests and retention for one shop (spec §21), operator only. */
export default async function CompanyPrivacyPage(props: PageProps<"/admin/companies/[companyId]/privacy">) {
  const { companyId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  await requirePageContext({ permission: "admin.access" }, `/admin/companies/${companyId}/privacy`);
  const t = await getTranslations("dsr");
  const [requests, retention] = await Promise.all([listDataSubjectRequests(companyId), getRetentionSummary(companyId)]);
  return (
    <div className="max-w-5xl space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{t("title")}</h2>
          <p className="mt-1 text-[13px] text-muted">{t("description")}</p>
        </div>
        <DsrTable
          rows={requests}
          companyId={companyId}
          customerHref={(id) => `/admin/companies/${companyId}/customers/${id}`}
          operator
          now={new Date()}
          emptyText={t("empty")}
        />
      </section>
      <RetentionCard summary={retention} companyId={companyId} canKeep />
    </div>
  );
}
