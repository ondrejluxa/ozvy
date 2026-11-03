import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CampaignsTable, parseCampaignTab } from "@/components/campaigns/campaigns-table";
import { RealCampaignList } from "@/components/campaigns/real-campaigns";
import { PageHeader } from "@/components/shell/page-header";
import { requireClientCompany } from "@/lib/auth/client-company";
import { getSupportView } from "@/lib/auth/context";
import { listCampaigns } from "@/lib/db/queries";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("campaigns");
  return { title: t("title") };
}

export default async function ClientCampaignsPage(props: PageProps<"/app/campaigns">) {
  const t = await getTranslations("campaigns");
  if (env.DATA_SOURCE === "supabase") {
    const { membership } = await requireClientCompany("/app/campaigns");
    return (
      <>
        <PageHeader title={t("title")} />
        <RealCampaignList companyId={membership.companyId} basePath="/app/campaigns" />
      </>
    );
  }

  const view = await getSupportView();
  if (!view) redirect("/admin");
  const data = listCampaigns(view.companyId);
  if (!data) redirect("/admin");
  const { tab } = await props.searchParams;
  return (
    <>
      <PageHeader title={t("title")} />
      <CampaignsTable
        rows={data.rows}
        tab={parseCampaignTab(tab)}
        tabHref={(k) => (k === "all" ? "/app/campaigns" : `/app/campaigns?tab=${k}`)}
        detailHref={(r) => `/app/campaigns/${r.campaign.id}`}
      />
    </>
  );
}
