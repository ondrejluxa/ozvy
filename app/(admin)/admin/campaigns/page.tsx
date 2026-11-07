import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CampaignsTable, parseCampaignTab } from "@/components/campaigns/campaigns-table";
import { RealAllCampaignsList } from "@/components/campaigns/real-campaigns";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageContext } from "@/lib/auth/context";
import { listAllCampaigns } from "@/lib/db/queries";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.campaigns");
  return { title: t("title") };
}

/** Every shop's campaigns in one list (spec §8, operator only). */
export default async function AllCampaignsPage(props: PageProps<"/admin/campaigns">) {
  const t = await getTranslations("admin.campaigns");
  const header = <PageHeader title={t("title")} description={t("subtitle")} />;

  if (env.DATA_SOURCE === "supabase") {
    await requirePageContext({ permission: "admin.access" }, "/admin/campaigns");
    return (
      <>
        {header}
        <RealAllCampaignsList />
      </>
    );
  }

  const { tab } = await props.searchParams;
  const rows = listAllCampaigns();
  return (
    <>
      {header}
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
