import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getCampaignDelivery, type MessageStatus } from "@/lib/db/supabase/messaging";
import { formatCZK, formatInt } from "@/lib/domain/money";

const COLUMNS: { key: string; statuses: MessageStatus[] }[] = [
  { key: "queued", statuses: ["queued", "sending"] },
  { key: "sent", statuses: ["sent", "delivered"] },
  { key: "failed", statuses: ["failed", "undelivered", "expired"] },
  { key: "cancelled", statuses: ["cancelled"] },
  { key: "review", statuses: ["needs_review"] },
];

/**
 * Delivery progress of a started campaign (spec §8 "Kampaň – detail"):
 * the snapshot (contacted vs. holdout) and messages per step and outcome.
 * Shown to the operator and the shop alike; no contact data.
 */
export async function DeliveryPanel({ companyId, campaignId }: { companyId: string; campaignId: string }) {
  const [t, tc, d] = await Promise.all([
    getTranslations("campaignDelivery"),
    getTranslations("campaignBuilder"),
    getCampaignDelivery(companyId, campaignId),
  ]);
  if (d.enrolled === 0) return null;
  return (
    <Card data-testid="delivery-panel">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {(
            [
              ["enrolled", formatInt(d.enrolled)],
              ["contacted", formatInt(d.contacted)],
              ["holdout", formatInt(d.holdout)],
              ["cost", formatCZK(d.costMinor)],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="text-[12px] text-muted">{t(`facts.${key}`)}</dt>
              <dd className="tnum font-semibold text-ink" data-testid={`delivery-${key}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {d.steps.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>{t("columns.step")}</TH>
                  {COLUMNS.map((c) => (
                    <TH key={c.key} className="text-right">
                      {t(`columns.${c.key}`)}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {d.steps.map((s) => (
                  <TR key={s.stepNumber} data-testid={`delivery-step-${s.stepNumber}`}>
                    <TD className="text-ink">
                      {s.stepNumber === 0 ? tc("initial") : t("followup", { n: s.stepNumber })}
                    </TD>
                    {COLUMNS.map((c) => (
                      <TD key={c.key} className="tnum text-right text-ink-2" data-testid={`delivery-${c.key}`}>
                        {formatInt(c.statuses.reduce((sum, st) => sum + (s.byStatus[st] ?? 0), 0))}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <p className="text-[12px] text-muted">{t("holdoutNote")}</p>
      </CardContent>
    </Card>
  );
}
