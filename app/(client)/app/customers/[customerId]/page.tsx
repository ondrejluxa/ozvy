import { notFound, redirect } from "next/navigation";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { getSupportView } from "@/lib/auth/context";
import { getCustomerDetail } from "@/lib/db/queries";

export default async function ClientCustomerPage(props: PageProps<"/app/customers/[customerId]">) {
  const view = await getSupportView();
  if (!view) redirect("/admin");
  const { customerId } = await props.params;
  // Scoped to the viewed company: another shop's customer id resolves to 404.
  const data = getCustomerDetail(view.companyId, customerId);
  if (!data) notFound();
  return (
    <CustomerDetail data={data} backHref="/app/customers" campaignHref={(id) => `/app/campaigns/${id}`} readOnly />
  );
}
