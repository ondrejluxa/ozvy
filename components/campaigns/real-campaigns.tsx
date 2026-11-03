import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CampaignStatusBadge } from "@/components/common/badges";
import { ApprovalPanel, OperatorCampaignActions } from "@/components/campaigns/real-campaign-actions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getCampaign, listCampaigns, previewRecipients } from "@/lib/db/supabase/campaigns";
import { getCompanyRecord } from "@/lib/db/supabase/companies";
import { resolveCompanySettings } from "@/lib/domain/company-settings";
import { statusGroup } from "@/lib/domain/campaigns/status";
import { formatDateTime } from "@/lib/domain/dates";
import { optOutToken, renderTemplate } from "@/lib/domain/messaging/render";
import { countSmsSegments } from "@/lib/domain/messaging/sms-segments";
import { formatInt, formatPercent } from "@/lib/domain/money";

/** Campaigns on real data (spec §8 "Kampaně – seznam", "Kampaň – detail"). Sending arrives in slice 12. */

const GROUPS = ["prepared", "active", "finished"] as const;

export async function RealCampaignList({ companyId, basePath }: { companyId: string; basePath: string }) {
  const t = await getTranslations("campaignList");
  const tPreset = await getTranslations("presets");
  const campaigns = await listCampaigns(companyId);
  if (campaigns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
        {t("empty")}
      </p>
    );
  }
  return (
    <div className="space-y-8">
      {GROUPS.map((group) => {
        const rows = campaigns.filter((c) => statusGroup(c.status) === group);
        if (rows.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
              {t(`groups.${group}`)}
            </h2>
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <Table>
                <THead>
                  <TR>
                    <TH>{t("columns.name")}</TH>
                    <TH>{t("columns.segment")}</TH>
                    <TH>{t("columns.sendAt")}</TH>
                    <TH className="text-right">{t("columns.recipients")}</TH>
                    <TH>{t("columns.status")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((c) => (
                    <TR key={c.id} data-testid="campaign-row">
                      <TD>
                        <Link href={`${basePath}/${c.id}`} className="font-medium text-ink hover:underline">
                          {c.name}
                        </Link>
                      </TD>
                      <TD className="text-ink-2">
                        {c.presetKey ? tPreset(`${c.presetKey}.name`) : (c.segmentName ?? "—")}
                      </TD>
                      <TD className="tnum whitespace-nowrap text-ink-2">
                        {c.scheduledAt ? formatDateTime(c.scheduledAt) : "—"}
                      </TD>
                      <TD className="tnum text-right text-ink-2">
                        {c.recipients === null ? "—" : formatInt(c.recipients)}
                      </TD>
                      <TD>
                        <CampaignStatusBadge status={c.status} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export async function RealCampaignDetail({
  companyId,
  campaignId,
  basePath,
  viewer,
}: {
  companyId: string;
  campaignId: string;
  basePath: string;
  viewer: { kind: "operator" } | { kind: "client"; canDecide: boolean };
}) {
  const t = await getTranslations("campaignDetail");
  const tc = await getTranslations("campaignBuilder");
  const tPreset = await getTranslations("presets");
  const [loaded, company] = await Promise.all([getCampaign(companyId, campaignId), getCompanyRecord(companyId)]);
  if (!loaded || !company) return null;
  const { campaign, steps, segmentName } = loaded;
  const sample = (await previewRecipients(companyId, campaign, 1))[0] ?? null;
  const settings = resolveCompanySettings(company.settings);
  const shop = { shopName: settings.message_shop_name ?? company.name, phone: company.phone };
  const now = new Date();

  return (
    <>
      <PageHeader
        back={{ href: basePath, label: t("back") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {campaign.name} <CampaignStatusBadge status={campaign.status} />
          </span>
        }
        description={
          campaign.segment_preset
            ? tPreset(`${campaign.segment_preset as "no_visit_12m"}.name`)
            : (segmentName ?? undefined)
        }
        actions={
          viewer.kind === "operator" ? (
            <OperatorCampaignActions
              companyId={companyId}
              campaignId={campaignId}
              status={campaign.status}
              requiresClientApproval={company.requires_client_approval}
              basePath={basePath}
            />
          ) : undefined
        }
      />

      <div className="space-y-6">
        {campaign.status === "draft" && campaign.approval_comment && (
          <p
            className="rounded-md border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn"
            data-testid="returned-comment"
          >
            <strong className="font-semibold">{t("returned")}</strong> {campaign.approval_comment}
          </p>
        )}
        {campaign.status === "waiting_for_approval" &&
          (viewer.kind === "client" && viewer.canDecide ? (
            <ApprovalPanel companyId={companyId} campaignId={campaignId} />
          ) : (
            <p className="rounded-md bg-info-soft px-4 py-3 text-sm text-info">{t("waiting")}</p>
          ))}

        <Card>
          <CardContent className="pt-5">
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-4">
              <Fact
                label={t("recipients")}
                value={campaign.approved_recipient_count === null ? "—" : formatInt(campaign.approved_recipient_count)}
                testId="detail-recipients"
              />
              <Fact label={t("holdout")} value={formatPercent(Number(campaign.holdout_pct))} />
              <Fact label={t("sendAt")} value={campaign.scheduled_at ? formatDateTime(campaign.scheduled_at) : "—"} />
              <Fact label={t("steps")} value={String(steps.length)} />
            </dl>
          </CardContent>
        </Card>

        {steps.map((s) => {
          const rendered = sample
            ? renderTemplate(s.body_template, {
                recipient: sample,
                shop,
                optOutUrl: `example.cz/o/${optOutToken(sample.enrollmentKey)}`,
                now,
                stripDiacritics: s.strip_diacritics,
              })
            : null;
          const seg = rendered ? countSmsSegments(rendered.text) : null;
          return (
            <Card key={s.id} data-testid={`step-${s.step_number}`}>
              <CardHeader>
                <CardTitle>
                  {s.step_number === 0 ? tc("initial") : tc("followup", { n: s.step_number, days: s.delay_days })}
                </CardTitle>
                {seg && <span className="text-[12px] text-muted">{tc("segmentsPerSms", { count: seg.segments })}</span>}
              </CardHeader>
              <CardContent className="space-y-3">
                {rendered && (
                  <p className="max-w-md whitespace-pre-line rounded-2xl rounded-bl-sm bg-subtle px-4 py-3 text-sm leading-relaxed text-ink">
                    {rendered.text}
                  </p>
                )}
                <details className="text-[12px] text-muted">
                  <summary className="cursor-pointer">{t("template")}</summary>
                  <p className="mt-1 whitespace-pre-line font-mono">{s.body_template}</p>
                </details>
              </CardContent>
            </Card>
          );
        })}
        <p className="text-[12px] text-muted">{t("sendingLater")}</p>
      </div>
    </>
  );
}

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="tnum font-semibold text-ink" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
