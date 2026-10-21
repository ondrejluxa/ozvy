import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CustomerList } from "@/components/customers/customer-list";
import { RealCustomerList, pageParam } from "@/components/customers/real-customer-list";
import { requirePageContext } from "@/lib/auth/context";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("title") };
}

export default async function CompanyCustomersPage(props: PageProps<"/admin/companies/[companyId]/customers">) {
  const { companyId } = await props.params;
  const searchParams = await props.searchParams;
  const basePath = `/admin/companies/${companyId}/customers`;
  if (env.DATA_SOURCE === "supabase") {
    await requirePageContext({ permission: "admin.access" }, basePath);
    return <RealCustomerList companyId={companyId} basePath={basePath} page={pageParam(searchParams.page)} />;
  }
  return <CustomerList companyId={companyId} basePath={basePath} searchParams={searchParams} />;
}
