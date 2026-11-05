import { notFound, redirect } from "next/navigation";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { RealCampaignDetail } from "@/components/campaigns/real-campaigns";
import { requireClientCompany } from "@/lib/auth/client-company";
import { getSupportView } from "@/lib/auth/context";
import { getCampaignDetail, type RecipientFilter } from "@/lib/db/queries";
import { getCampaign } from "@/lib/db/supabase/campaigns";
import { can } from "@/lib/auth/permissions";
import { canDecideApproval } from "@/lib/domain/campaigns/status";
import { env } from "@/lib/env";

const FILTERS: RecipientFilter[] = ["all", "booked", "completed", "holdout", "failed"];

export default async function ClientCampaignPage(props: PageProps<"/app/campaigns/[campaignId]">) {
  const { campaignId } = await props.params;
  const sp = await props.searchParams;

  if (env.DATA_SOURCE === "supabase") {
    // Mobile-friendly approval page (spec §6 F4); the company comes from the membership.
    const { membership, session } = await requireClientCompany(`/app/campaigns/${campaignId}`);
    if (!(await getCampaign(membership.companyId, campaignId))) notFound();
    return (
      <RealCampaignDetail
        companyId={membership.companyId}
        campaignId={campaignId}
        basePath="/app/campaigns"
        viewer={{
          kind: "client",
          canDecide: canDecideApproval({
            isPlatformAdmin: session.isPlatformAdmin,
            role: membership.role,
            requiresClientApproval: membership.requiresClientApproval,
          }),
          canPause: can({ isPlatformAdmin: session.isPlatformAdmin, ...membership }, "campaigns.pause"),
        }}
        recipients={{
          filter: typeof sp.stav === "string" ? sp.stav : undefined,
          page: typeof sp.strana === "string" ? sp.strana : undefined,
          canMark: can({ isPlatformAdmin: session.isPlatformAdmin, ...membership }, "conversions.mark"),
          customerHref: "/app/customers",
        }}
      />
    );
  }

  const view = await getSupportView();
  if (!view) redirect("/admin");
  const filter = FILTERS.find((f) => f === sp.filter) ?? "all";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : undefined;
  const data = getCampaignDetail(view.companyId, campaignId, { filter, q, page: Number(sp.page) || 1 });
  if (!data) notFound();
  return (
    <CampaignDetail
      data={data}
      backHref="/app/campaigns"
      basePath={`/app/campaigns/${campaignId}`}
      customerHref={(id) => `/app/customers/${id}`}
      readOnly
      autoSend={false}
      q={q}
    />
  );
}
