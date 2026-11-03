import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CampaignBuilder, type BuilderStep } from "@/components/campaigns/builder/campaign-builder";
import { RealCampaignBuilder } from "@/components/campaigns/real-builder";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageContext } from "@/lib/auth/context";
import { getBuilderData } from "@/lib/db/queries";
import { getRealBuilderData } from "@/lib/db/supabase/campaigns";
import { CAMPAIGN_NAME_PREFIX, MONTH_NOMINATIVE } from "@/lib/db/demo/fixtures";
import { pragueParts } from "@/lib/domain/dates";
import { defaultCampaignSlot, nextSendingSlot } from "@/lib/domain/messaging/sending-window";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("builder");
  return { title: t("title") };
}

const STEPS: BuilderStep[] = ["segment", "message", "schedule", "review"];

export default async function NewCampaignPage(props: PageProps<"/admin/companies/[companyId]/campaigns/new">) {
  const { companyId } = await props.params;
  const sp = await props.searchParams;
  const preset = typeof sp.preset === "string" ? sp.preset : undefined;
  const segment = typeof sp.segment === "string" ? sp.segment : undefined;
  const t = await getTranslations("builder");
  const tCampaign = await getTranslations("campaign");
  const base = `/admin/companies/${companyId}/campaigns`;
  const slot = defaultCampaignSlot();
  const p = pragueParts(slot);
  const month = `${MONTH_NOMINATIVE[p.month - 1]} ${p.year}`;

  if (env.DATA_SOURCE === "supabase") {
    await requirePageContext({ permission: "admin.access" }, `${base}/new`);
    const data = await getRealBuilderData(companyId, { preset, segment });
    if (!data) notFound();
    const prefix = data.source.presetKey ? CAMPAIGN_NAME_PREFIX[data.source.presetKey] : data.source.segmentName;
    return (
      <>
        <PageHeader title={t("title")} back={{ href: base, label: tCampaign("back") }} />
        <RealCampaignBuilder
          key={data.source.presetKey ?? data.source.segmentId}
          data={data}
          basePath={base}
          defaultName={`${prefix} – ${month}`.slice(0, 80)}
          defaultSendAt={slot.toISOString()}
        />
      </>
    );
  }

  const stepParam = typeof sp.step === "string" ? sp.step : "segment";
  const data = getBuilderData(companyId, preset);
  if (!data) notFound();
  const defaultName = `${CAMPAIGN_NAME_PREFIX[data.presetKey]} – ${month}`;
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
        defaultSendAt={nextSendingSlot(new Date()).toISOString()}
        defaultName={defaultName}
        basePath={base}
      />
    </>
  );
}
