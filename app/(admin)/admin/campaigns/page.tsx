import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CampaignsTable, parseCampaignTab } from "@/components/campaigns/campaigns-table";
import { PageHeader } from "@/components/shell/page-header";
import { listAllCampaigns } from "@/lib/db/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.campaigns");
  return { title: t("title") };
}

export default async function AllCampaignsPage(props: PageProps<"/admin/campaigns">) {
  const t = await getTranslations("admin.campaigns");
  const { tab } = await props.searchParams;
  const rows = listAllCampaigns();
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <CampaignsTable
        rows={rows}
        tab={parseCampaignTab(tab)}
        tabHref={(k) => (k === "all" ? "/admin/campaigns" : `/admin/campaigns?tab=${k}`)}
        detailHref={(r) => `/admin/companies/${r.campaign.company_id}/campaigns/${r.campaign.id}`}
        showShop
      />
    </>
  );
}
