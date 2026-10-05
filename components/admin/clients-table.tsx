import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HealthDot } from "@/components/common/badges";
import { CompanyName } from "@/components/demo/demo-labels";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ClientRow } from "@/lib/db/queries";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK, formatROI } from "@/lib/domain/money";

export async function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const t = await getTranslations("admin.clients");
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <Table>
        <THead>
          <TR>
            <TH>{t("name")}</TH>
            <TH>{t("plan")}</TH>
            <TH className="text-right">{t("mrr")}</TH>
            <TH className="text-right">{t("revenue")}</TH>
            <TH className="text-right">{t("roi")}</TH>
            <TH>{t("lastCampaign")}</TH>
            <TH className="text-right">{t("alerts")}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.company.id} className="hover:bg-subtle/60">
              <TD>
                <Link
                  href={`/admin/companies/${r.company.id}`}
                  className="flex items-center gap-2.5 font-medium text-ink hover:underline"
                >
                  <HealthDot health={r.health} label={t(`health.${r.health}`)} />
                  <span>
                    <CompanyName name={r.company.name} />
                    <span className="block text-[12px] font-normal text-muted">{r.company.city}</span>
                  </span>
                </Link>
              </TD>
              <TD className="text-ink-2">{r.planName}</TD>
              <TD className="tnum text-right">{formatCZK(r.mrrMinor)}</TD>
              <TD className="tnum text-right font-medium text-accent">{formatCZK(r.revenueThisMonthMinor)}</TD>
              <TD className="tnum text-right">{formatROI(r.roi)}</TD>
              <TD className="whitespace-nowrap text-ink-2">
                {r.lastCampaignAt ? formatDate(r.lastCampaignAt) : t("never")}
              </TD>
              <TD className="tnum text-right">{r.openAlerts || "—"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
