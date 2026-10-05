import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClientsTable } from "@/components/admin/clients-table";
import { PageHeader } from "@/components/shell/page-header";
import { getAdminOverview } from "@/lib/db/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.clients");
  return { title: t("title") };
}

export default async function CompaniesPage() {
  const t = await getTranslations("admin.clients");
  const { clients } = getAdminOverview();
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ClientsTable rows={clients} />
    </>
  );
}
