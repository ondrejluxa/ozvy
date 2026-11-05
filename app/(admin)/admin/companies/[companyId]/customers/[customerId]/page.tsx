import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { RealCustomerDetail } from "@/components/customers/real-customer-detail";
import { requirePageContext } from "@/lib/auth/context";
import { getCustomerDetail } from "@/lib/db/queries";
import { getCustomerDetail as getRealCustomerDetail } from "@/lib/db/supabase/customers";
import { env } from "@/lib/env";

export async function generateMetadata(
  props: PageProps<"/admin/companies/[companyId]/customers/[customerId]">,
): Promise<Metadata> {
  const { companyId, customerId } = await props.params;
  if (env.DATA_SOURCE === "supabase") {
    return { title: (await getRealCustomerDetail(companyId, customerId))?.customer.name };
  }
  return { title: getCustomerDetail(companyId, customerId)?.name };
}

export default async function AdminCustomerPage(
  props: PageProps<"/admin/companies/[companyId]/customers/[customerId]">,
) {
  const { companyId, customerId } = await props.params;
  const base = `/admin/companies/${companyId}`;
  if (env.DATA_SOURCE === "supabase") {
    await requirePageContext({ permission: "admin.access" }, `${base}/customers/${customerId}`);
    const data = await getRealCustomerDetail(companyId, customerId);
    if (!data) notFound();
    return <RealCustomerDetail data={data} backHref={`${base}/customers`} canEdit canMark />;
  }
  const data = getCustomerDetail(companyId, customerId);
  if (!data) notFound();
  return (
    <CustomerDetail
      data={data}
      backHref={`${base}/customers`}
      campaignHref={(id) => `${base}/campaigns/${id}`}
      readOnly={false}
    />
  );
}
