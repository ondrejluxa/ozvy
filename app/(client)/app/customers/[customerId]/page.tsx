import { notFound, redirect } from "next/navigation";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { RealCustomerDetail } from "@/components/customers/real-customer-detail";
import { requireClientCompany } from "@/lib/auth/client-company";
import { getSupportView, requireContext } from "@/lib/auth/context";
import { getCustomerDetail } from "@/lib/db/queries";
import { getCustomerDetail as getRealCustomerDetail } from "@/lib/db/supabase/customers";
import { env } from "@/lib/env";

export default async function ClientCustomerPage(props: PageProps<"/app/customers/[customerId]">) {
  const { customerId } = await props.params;

  if (env.DATA_SOURCE === "supabase") {
    // The company comes from the user's membership; another shop's customer ID is a 404 (spec §38.5).
    const { membership } = await requireClientCompany(`/app/customers/${customerId}`);
    const data = await getRealCustomerDetail(membership.companyId, customerId);
    if (!data) notFound();
    const canEdit = await requireContext({ permission: "customers.edit_contact", companyId: membership.companyId })
      .then(() => true)
      .catch(() => false);
    const canMark = await requireContext({ permission: "conversions.mark", companyId: membership.companyId })
      .then(() => true)
      .catch(() => false);
    return <RealCustomerDetail data={data} backHref="/app/customers" canEdit={canEdit} canMark={canMark} />;
  }

  const view = await getSupportView();
  if (!view) redirect("/admin");
  // Scoped to the viewed company: another shop's customer id resolves to 404.
  const data = getCustomerDetail(view.companyId, customerId);
  if (!data) notFound();
  return (
    <CustomerDetail data={data} backHref="/app/customers" campaignHref={(id) => `/app/campaigns/${id}`} readOnly />
  );
}
