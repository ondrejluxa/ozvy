import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { getCampaignDetail, type RecipientFilter } from "@/lib/db/queries";

const FILTERS: RecipientFilter[] = ["all", "booked", "completed", "holdout", "failed"];

type Props = PageProps<"/admin/companies/[companyId]/campaigns/[campaignId]">;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { companyId, campaignId } = await props.params;
  return { title: getCampaignDetail(companyId, campaignId)?.campaign.name };
}

export default async function AdminCampaignPage(props: Props) {
  const { companyId, campaignId } = await props.params;
  const sp = await props.searchParams;
  const filter = FILTERS.find((f) => f === sp.filter) ?? "all";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : undefined;
  const data = getCampaignDetail(companyId, campaignId, { filter, q, page: Number(sp.page) || 1 });
  if (!data) notFound();
  const base = `/admin/companies/${companyId}`;
  return (
    <CampaignDetail
      data={data}
      backHref={`${base}/campaigns`}
      basePath={`${base}/campaigns/${campaignId}`}
      customerHref={(id) => `${base}/customers/${id}`}
      readOnly={false}
      autoSend={sp.sending === "1"}
      q={q}
    />
  );
}
