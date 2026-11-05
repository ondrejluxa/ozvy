import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HealthDot } from "@/components/common/badges";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { RealClientRow } from "@/lib/db/supabase/dashboard";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK, formatROI } from "@/lib/domain/money";

/** Clients list on real data (spec §10): health from open alerts, red first. */
export async function RealClientsTable({ rows }: { rows: RealClientRow[] }) {
  const t = await getTranslations("admin.clients");
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <Table>
        <THead>
          <TR>
            <TH>{t("name")}</TH>
            <TH className="text-right">{t("mrr")}</TH>
            <TH className="text-right">{t("revenue")}</TH>
            <TH className="text-right">{t("roi")}</TH>
            <TH>{t("lastCampaign")}</TH>
            <TH className="text-right">{t("alerts")}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id} className="hover:bg-subtle/60" data-testid="client-row">
              <TD>
                <Link
                  href={`/admin/companies/${r.id}`}
                  className="flex items-center gap-2.5 font-medium text-ink hover:underline"
                >
                  <HealthDot health={r.health} label={t(`health.${r.health}`)} />
                  <span>
                    {r.name}
                    {r.city && <span className="block text-[12px] font-normal text-muted">{r.city}</span>}
                  </span>
                </Link>
              </TD>
              <TD className="tnum text-right">{formatCZK(r.mrrMinor)}</TD>
              <TD className="tnum text-right font-medium text-accent">{formatCZK(r.revenueThisMonthMinor)}</TD>
              <TD className="tnum text-right">{formatROI(r.roi)}</TD>
              <TD className="whitespace-nowrap text-ink-2">
                {r.lastCampaignAt ? formatDate(r.lastCampaignAt) : t("never")}
              </TD>
              <TD className="tnum text-right" data-testid="client-alerts">
                {r.openAlerts || "—"}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
