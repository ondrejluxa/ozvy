import { notFound, redirect } from "next/navigation";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { getSupportView } from "@/lib/auth/context";
import { getCampaignDetail, type RecipientFilter } from "@/lib/db/queries";

const FILTERS: RecipientFilter[] = ["all", "booked", "completed", "holdout", "failed"];

export default async function ClientCampaignPage(props: PageProps<"/app/campaigns/[campaignId]">) {
  const view = await getSupportView();
  if (!view) redirect("/admin");
  const { campaignId } = await props.params;
  const sp = await props.searchParams;
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
