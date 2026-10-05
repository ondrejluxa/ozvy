import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LifecycleBreakdown } from "@/components/common/lifecycle-breakdown";
import { SectionTitle } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getSegmentsOverview } from "@/lib/db/queries";
import { formatCZK, formatInt, roundEstimateMinor } from "@/lib/domain/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("segments");
  return { title: t("title") };
}

/** Segment presets, read-only in Phase 0 (spec §29): counts, exclusions and expected revenue. */
export default async function SegmentsPage(props: PageProps<"/admin/companies/[companyId]/segments">) {
  const { companyId } = await props.params;
  const data = getSegmentsOverview(companyId);
  if (!data) notFound();
  const t = await getTranslations("segments");
  const tPreset = await getTranslations("presets");
  const tUnavailable = await getTranslations("presetUnavailable");
  const tExcl = await getTranslations("exclusions");
  const tOpp = await getTranslations("opportunity");

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>{t("lifecycle")}</SectionTitle>
        <Card>
          <CardContent>
            <LifecycleBreakdown counts={data.statusCounts} />
            <p className="mt-4 text-[12px] text-muted">{t("lifecycleRules")}</p>
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionTitle>{t("title")}</SectionTitle>
        <p className="-mt-2 mb-4 text-[13px] text-muted">{t("subtitle")}</p>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <Table>
            <THead>
              <TR>
                <TH>{t("columns.segment")}</TH>
                <TH className="text-right">{t("columns.matched")}</TH>
                <TH className="text-right">{t("columns.eligible")}</TH>
                <TH className="text-right">{t("columns.excluded")}</TH>
                <TH className="text-right">{t("columns.expected")}</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {data.presets.map((p) => {
                const topReason = Object.entries(p.excluded).sort((a, b) => b[1] - a[1])[0];
                return (
                  <TR key={p.presetKey}>
                    <TD className="min-w-64 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{tPreset(`${p.presetKey}.name`)}</span>
                        {data.recommended === p.presetKey && <Badge tone="accent">{tOpp("recommended")}</Badge>}
                        {p.unavailableReason && <Badge tone="outline">{tUnavailable(p.unavailableReason)}</Badge>}
                        {p.recentlyUsed && <Badge tone="neutral">{t("recentlyUsed")}</Badge>}
                      </div>
                      <span className="text-[12px] text-muted">{tPreset(`${p.presetKey}.description`)}</span>
                    </TD>
                    <TD className="tnum text-right">{formatInt(p.matched)}</TD>
                    <TD className="tnum text-right font-medium">{formatInt(p.eligible)}</TD>
                    <TD
                      className="tnum text-right text-muted"
                      title={topReason && topReason[1] > 0 ? tExcl(topReason[0]) : undefined}
                    >
                      {formatInt(p.excludedTotal)}
                    </TD>
                    <TD className="tnum whitespace-nowrap text-right font-medium text-accent">
                      {p.eligible ? `~ ${formatCZK(roundEstimateMinor(p.expectedRevenueMinor))}` : "—"}
                    </TD>
                    <TD className="text-right">
                      {!p.unavailableReason && p.eligible > 0 && (
                        <Button asChild size="sm" variant={data.recommended === p.presetKey ? "accent" : "outline"}>
                          <Link href={`/admin/companies/${companyId}/campaigns/new?preset=${p.presetKey}`}>
                            {t("create")}
                          </Link>
                        </Button>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
