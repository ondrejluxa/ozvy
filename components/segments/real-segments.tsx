import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArchiveSegmentButton, SegmentBuilder } from "@/components/segments/segment-builder";
import { SectionTitle } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listSegments, presetsOverview, type SegmentCounts } from "@/lib/db/supabase/segments";
import { formatInt } from "@/lib/domain/money";

/**
 * Segments on real data (spec §12): the nine presets and saved segments with
 * live counts after eligibility and contact rules, plus the builder.
 */
export async function RealSegments({ companyId }: { companyId: string }) {
  const t = await getTranslations("segments");
  const tPreset = await getTranslations("presets");
  const tUnavailable = await getTranslations("presetUnavailable");
  const [presets, saved] = await Promise.all([presetsOverview(companyId), listSegments(companyId)]);

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>{t("title")}</SectionTitle>
        <p className="-mt-2 mb-4 text-[13px] text-muted">{t("real.subtitle")}</p>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <Table>
            <THead>
              <TR>
                <TH>{t("columns.segment")}</TH>
                <TH className="text-right">{t("columns.matched")}</TH>
                <TH className="text-right">{t("columns.eligible")}</TH>
                <TH>{t("columns.excluded")}</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {presets.map((p) => (
                <TR key={p.key} data-testid={`preset-${p.key}`}>
                  <TD className="min-w-64 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{tPreset(`${p.key}.name`)}</span>
                      {p.unavailableReason && <Badge tone="outline">{tUnavailable(p.unavailableReason)}</Badge>}
                    </div>
                    <span className="text-[12px] text-muted">{tPreset(`${p.key}.description`)}</span>
                  </TD>
                  <TD className="tnum text-right">{p.counts ? formatInt(p.counts.matched) : "—"}</TD>
                  <TD className="tnum text-right font-medium" data-testid="eligible">
                    {p.counts ? formatInt(p.counts.eligible) : "—"}
                  </TD>
                  <TD>{p.counts && <Exclusions counts={p.counts} />}</TD>
                  <TD className="text-right">
                    {p.counts && p.counts.eligible > 0 && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/companies/${companyId}/campaigns/new?preset=${p.key}`}>
                          {t("real.createCampaign")}
                        </Link>
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </section>

      <section>
        <SectionTitle>{t("real.saved")}</SectionTitle>
        {saved.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
            {t("real.noSaved")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <Table>
              <THead>
                <TR>
                  <TH>{t("columns.segment")}</TH>
                  <TH className="text-right">{t("columns.matched")}</TH>
                  <TH className="text-right">{t("columns.eligible")}</TH>
                  <TH>{t("columns.excluded")}</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {saved.map((s) => (
                  <TR key={s.id} data-testid="saved-segment">
                    <TD className="font-medium text-ink">{s.name}</TD>
                    <TD className="tnum text-right">{formatInt(s.counts.matched)}</TD>
                    <TD className="tnum text-right font-medium">{formatInt(s.counts.eligible)}</TD>
                    <TD>
                      <Exclusions counts={s.counts} />
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      {s.counts.eligible > 0 && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/companies/${companyId}/campaigns/new?segment=${s.id}`}>
                            {t("real.createCampaign")}
                          </Link>
                        </Button>
                      )}
                      <ArchiveSegmentButton companyId={companyId} segmentId={s.id} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <SectionTitle>{t("real.builderTitle")}</SectionTitle>
        <Card>
          <CardContent className="pt-5">
            <SegmentBuilder companyId={companyId} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export async function Exclusions({ counts }: { counts: SegmentCounts }) {
  const tExcl = await getTranslations("exclusions");
  const entries = Object.entries(counts.excluded).filter(([, n]) => (n ?? 0) > 0) as [string, number][];
  if (entries.length === 0) return <span className="text-[13px] text-faint">—</span>;
  return (
    <ul className="space-y-0.5 text-[12px] text-muted">
      {entries
        .sort((a, b) => b[1] - a[1])
        .map(([reason, n]) => (
          <li key={reason}>
            <span className="tnum font-medium text-ink-2">{formatInt(n)}</span> {tExcl(reason)}
          </li>
        ))}
    </ul>
  );
}
