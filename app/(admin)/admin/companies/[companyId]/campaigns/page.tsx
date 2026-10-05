import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { CampaignsTable, parseCampaignTab } from "@/components/campaigns/campaigns-table";
import { Button } from "@/components/ui/button";
import { listCampaigns } from "@/lib/db/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("campaigns");
  return { title: t("title") };
}

export default async function CompanyCampaignsPage(props: PageProps<"/admin/companies/[companyId]/campaigns">) {
  const { companyId } = await props.params;
  const { tab } = await props.searchParams;
  const data = listCampaigns(companyId);
  if (!data) notFound();
  const t = await getTranslations("campaigns");
  const base = `/admin/companies/${companyId}/campaigns`;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button asChild variant="accent" size="sm">
          <Link href={`${base}/new`}>
            <Plus aria-hidden />
            {t("new")}
          </Link>
        </Button>
      </div>
      <CampaignsTable
        rows={data.rows}
        tab={parseCampaignTab(tab)}
        tabHref={(k) => (k === "all" ? base : `${base}?tab=${k}`)}
        detailHref={(r) => `${base}/${r.campaign.id}`}
      />
    </>
  );
}
