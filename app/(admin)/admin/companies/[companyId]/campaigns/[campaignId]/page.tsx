import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { RealCampaignDetail } from "@/components/campaigns/real-campaigns";
import { requirePageContext } from "@/lib/auth/context";
import { getCampaignDetail, type RecipientFilter } from "@/lib/db/queries";
import { getCampaign } from "@/lib/db/supabase/campaigns";
import { env } from "@/lib/env";

const FILTERS: RecipientFilter[] = ["all", "booked", "completed", "holdout", "failed"];

type Props = PageProps<"/admin/companies/[companyId]/campaigns/[campaignId]">;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { companyId, campaignId } = await props.params;
  if (env.DATA_SOURCE === "supabase") return { title: (await getCampaign(companyId, campaignId))?.campaign.name };
  return { title: getCampaignDetail(companyId, campaignId)?.campaign.name };
}

export default async function AdminCampaignPage(props: Props) {
  const { companyId, campaignId } = await props.params;
  const sp = await props.searchParams;
  const base = `/admin/companies/${companyId}`;

  if (env.DATA_SOURCE === "supabase") {
    await requirePageContext({ permission: "admin.access" }, `${base}/campaigns/${campaignId}`);
    if (!(await getCampaign(companyId, campaignId))) notFound();
    return (
      <RealCampaignDetail
        companyId={companyId}
        campaignId={campaignId}
        basePath={`${base}/campaigns`}
        viewer={{ kind: "operator" }}
        recipients={{
          filter: typeof sp.stav === "string" ? sp.stav : undefined,
          page: typeof sp.strana === "string" ? sp.strana : undefined,
          canMark: true,
          customerHref: `${base}/customers`,
        }}
      />
    );
  }

  const filter = FILTERS.find((f) => f === sp.filter) ?? "all";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : undefined;
  const data = getCampaignDetail(companyId, campaignId, { filter, q, page: Number(sp.page) || 1 });
  if (!data) notFound();
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
