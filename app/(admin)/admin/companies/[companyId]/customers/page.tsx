import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CustomerList } from "@/components/customers/customer-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("title") };
}

export default async function CompanyCustomersPage(props: PageProps<"/admin/companies/[companyId]/customers">) {
  const { companyId } = await props.params;
  const searchParams = await props.searchParams;
  return (
    <CustomerList
      companyId={companyId}
      basePath={`/admin/companies/${companyId}/customers`}
      searchParams={searchParams}
    />
  );
}
