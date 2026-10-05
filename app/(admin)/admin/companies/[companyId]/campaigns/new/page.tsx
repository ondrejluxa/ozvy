import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CampaignBuilder, type BuilderStep } from "@/components/campaigns/builder/campaign-builder";
import { PageHeader } from "@/components/shell/page-header";
import { getBuilderData } from "@/lib/db/queries";
import { CAMPAIGN_NAME_PREFIX, MONTH_NOMINATIVE } from "@/lib/db/demo/fixtures";
import { pragueParts } from "@/lib/domain/dates";
import { nextSendingSlot } from "@/lib/domain/messaging/sending-window";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("builder");
  return { title: t("title") };
}

const STEPS: BuilderStep[] = ["segment", "message", "schedule", "review"];

export default async function NewCampaignPage(props: PageProps<"/admin/companies/[companyId]/campaigns/new">) {
  const { companyId } = await props.params;
  const sp = await props.searchParams;
  const preset = typeof sp.preset === "string" ? sp.preset : undefined;
  const stepParam = typeof sp.step === "string" ? sp.step : "segment";
  const data = getBuilderData(companyId, preset);
  if (!data) notFound();
  const t = await getTranslations("builder");
  const tCampaign = await getTranslations("campaign");

  const slot = nextSendingSlot(new Date());
  const p = pragueParts(slot);
  const defaultName = `${CAMPAIGN_NAME_PREFIX[data.presetKey]} – ${MONTH_NOMINATIVE[p.month - 1]} ${p.year}`;
  const base = `/admin/companies/${companyId}/campaigns`;
  // Later steps need client state; a fresh load starts at the message step at most.
  const initialStep: BuilderStep =
    STEPS.includes(stepParam as BuilderStep) && stepParam === "message" ? "message" : "segment";

  return (
    <>
      <PageHeader title={t("title")} back={{ href: base, label: tCampaign("back") }} />
      <CampaignBuilder
        key={data.presetKey}
        data={data}
        initialStep={initialStep}
        defaultSendAt={slot.toISOString()}
        defaultName={defaultName}
        basePath={base}
      />
    </>
  );
}
