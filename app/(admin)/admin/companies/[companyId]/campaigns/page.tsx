import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { CampaignsTable, parseCampaignTab } from "@/components/campaigns/campaigns-table";
import { RealCampaignList } from "@/components/campaigns/real-campaigns";
import { Button } from "@/components/ui/button";
import { requirePageContext } from "@/lib/auth/context";
import { listCampaigns } from "@/lib/db/queries";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("campaigns");
  return { title: t("title") };
}

export default async function CompanyCampaignsPage(props: PageProps<"/admin/companies/[companyId]/campaigns">) {
  const { companyId } = await props.params;
  const { tab } = await props.searchParams;
  const t = await getTranslations("campaigns");
  const base = `/admin/companies/${companyId}/campaigns`;
  const newButton = (
    <div className="mb-4 flex justify-end">
      <Button asChild variant="accent" size="sm">
        <Link href={`${base}/new`}>
          <Plus aria-hidden />
          {t("new")}
        </Link>
      </Button>
    </div>
  );

  if (env.DATA_SOURCE === "supabase") {
    await requirePageContext({ permission: "admin.access" }, base);
    return (
      <>
        {newButton}
        <RealCampaignList companyId={companyId} basePath={base} />
      </>
    );
  }

  const data = listCampaigns(companyId);
  if (!data) notFound();
  return (
    <>
      {newButton}
      <CampaignsTable
        rows={data.rows}
        tab={parseCampaignTab(tab)}
        tabHref={(k) => (k === "all" ? base : `${base}?tab=${k}`)}
        detailHref={(r) => `${base}/${r.campaign.id}`}
      />
    </>
  );
}
