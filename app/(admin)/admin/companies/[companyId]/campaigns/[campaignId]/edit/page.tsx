import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RealCampaignBuilder } from "@/components/campaigns/real-builder";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageContext } from "@/lib/auth/context";
import { getCampaign, getRealBuilderData } from "@/lib/db/supabase/campaigns";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("campaignBuilder");
  return { title: t("editTitle") };
}

/** Edit a draft (also after the owner returned it with a comment). Real data only. */
export default async function EditCampaignPage(
  props: PageProps<"/admin/companies/[companyId]/campaigns/[campaignId]/edit">,
) {
  const { companyId, campaignId } = await props.params;
  if (env.DATA_SOURCE !== "supabase") notFound();
  const base = `/admin/companies/${companyId}/campaigns`;
  await requirePageContext({ permission: "admin.access" }, `${base}/${campaignId}/edit`);
  const loaded = await getCampaign(companyId, campaignId);
  if (!loaded) notFound();
  if (loaded.campaign.status !== "draft") redirect(`${base}/${campaignId}`);
  const { campaign, steps } = loaded;
  const data = await getRealBuilderData(companyId, {
    preset: campaign.segment_preset ?? undefined,
    segment: campaign.segment_id ?? undefined,
  });
  if (!data) notFound();
  const t = await getTranslations("campaignBuilder");
  return (
    <>
      <PageHeader title={t("editTitle")} back={{ href: `${base}/${campaignId}`, label: campaign.name }} />
      <RealCampaignBuilder
        data={data}
        basePath={base}
        defaultName={campaign.name}
        defaultSendAt={campaign.scheduled_at ?? new Date().toISOString()}
        initial={{
          campaignId,
          name: campaign.name,
          holdoutPct: Number(campaign.holdout_pct),
          scheduledAt: campaign.scheduled_at ?? new Date().toISOString(),
          steps: steps.map((s) => ({
            delayDays: s.delay_days,
            template: s.body_template,
            stripDiacritics: s.strip_diacritics,
          })),
        }}
      />
    </>
  );
}
