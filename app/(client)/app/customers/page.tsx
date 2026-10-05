import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerList } from "@/components/customers/customer-list";
import { PageHeader } from "@/components/shell/page-header";
import { getSupportView } from "@/lib/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("title") };
}

export default async function ClientCustomersPage(props: PageProps<"/app/customers">) {
  const view = await getSupportView();
  if (!view) redirect("/admin");
  const t = await getTranslations("customers");
  return (
    <>
      <PageHeader title={t("title")} />
      <CustomerList companyId={view.companyId} basePath="/app/customers" searchParams={await props.searchParams} />
    </>
  );
}
