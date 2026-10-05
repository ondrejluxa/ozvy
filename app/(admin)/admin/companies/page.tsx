import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClientsTable } from "@/components/admin/clients-table";
import { RealCompaniesTable } from "@/components/admin/real-companies";
import { PageHeader } from "@/components/shell/page-header";
import { getAdminOverview } from "@/lib/db/queries";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.clients");
  return { title: t("title") };
}

export default async function CompaniesPage() {
  const t = await getTranslations("admin.clients");
  if (env.DATA_SOURCE === "supabase") {
    return (
      <>
        <PageHeader title={t("title")} description={t("subtitle")} />
        <RealCompaniesTable />
      </>
    );
  }
  const { clients } = getAdminOverview();
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ClientsTable rows={clients} />
    </>
  );
}
