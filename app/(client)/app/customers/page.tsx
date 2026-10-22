import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerList } from "@/components/customers/customer-list";
import { RealCustomerList } from "@/components/customers/real-customer-list";
import { PageHeader } from "@/components/shell/page-header";
import { requireClientCompany } from "@/lib/auth/client-company";
import { getSupportView } from "@/lib/auth/context";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("title") };
}

export default async function ClientCustomersPage(props: PageProps<"/app/customers">) {
  const t = await getTranslations("customers");
  const searchParams = await props.searchParams;

  if (env.DATA_SOURCE === "supabase") {
    // The company comes from the user's own membership, never from the URL.
    const { membership } = await requireClientCompany("/app/customers");
    return (
      <>
        <PageHeader title={t("title")} />
        <RealCustomerList companyId={membership.companyId} basePath="/app/customers" searchParams={searchParams} />
      </>
    );
  }

  const view = await getSupportView();
  if (!view) redirect("/admin");
  return (
    <>
      <PageHeader title={t("title")} />
      <CustomerList companyId={view.companyId} basePath="/app/customers" searchParams={searchParams} />
    </>
  );
}
