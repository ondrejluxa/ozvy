import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { getCustomerDetail } from "@/lib/db/queries";

export async function generateMetadata(
  props: PageProps<"/admin/companies/[companyId]/customers/[customerId]">,
): Promise<Metadata> {
  const { companyId, customerId } = await props.params;
  return { title: getCustomerDetail(companyId, customerId)?.name };
}

export default async function AdminCustomerPage(
  props: PageProps<"/admin/companies/[companyId]/customers/[customerId]">,
) {
  const { companyId, customerId } = await props.params;
  const data = getCustomerDetail(companyId, customerId);
  if (!data) notFound();
  const base = `/admin/companies/${companyId}`;
  return (
    <CustomerDetail
      data={data}
      backHref={`${base}/customers`}
      campaignHref={(id) => `${base}/campaigns/${id}`}
      readOnly={false}
    />
  );
}
