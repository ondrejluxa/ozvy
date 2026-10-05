import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CampaignStatusBadge } from "@/components/common/badges";
import { CompanyName } from "@/components/demo/demo-labels";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { CampaignRow } from "@/lib/db/queries";
import type { CampaignStatus } from "@/lib/db/types";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK, formatInt } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

export type CampaignTab = "all" | "active" | "prepared" | "finished";

const GROUPS: Record<Exclude<CampaignTab, "all">, CampaignStatus[]> = {
  active: ["sending", "active", "paused"],
  prepared: ["draft", "waiting_for_approval", "scheduled"],
  finished: ["completed", "cancelled", "failed"],
};

export function parseCampaignTab(value: string | string[] | undefined): CampaignTab {
  return value === "active" || value === "prepared" || value === "finished" ? value : "all";
}

export async function CampaignsTable({
  rows,
  tab,
  tabHref,
  detailHref,
  showShop = false,
}: {
  rows: CampaignRow[];
  tab: CampaignTab;
  tabHref: (tab: CampaignTab) => string;
  detailHref: (row: CampaignRow) => string;
  showShop?: boolean;
}) {
  const t = await getTranslations("campaigns");
  const tPreset = await getTranslations("presets");
  const filtered = tab === "all" ? rows : rows.filter((r) => GROUPS[tab].includes(r.campaign.status));
  const count = (k: CampaignTab) =>
    k === "all" ? rows.length : rows.filter((r) => GROUPS[k].includes(r.campaign.status)).length;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex gap-1 overflow-x-auto px-3 pt-2 shadow-[inset_0_-1px_0_var(--color-line)]">
        {(["all", "active", "prepared", "finished"] as CampaignTab[]).map((k) => (
          <Link
            key={k}
            href={tabHref(k)}
            className={cn(
              "whitespace-nowrap border-b-2 px-2.5 pb-2 pt-1 text-[13px]",
              tab === k ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t(`tabs.${k}`)} <span className="tnum text-faint">{count(k)}</span>
          </Link>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">{rows.length ? t("emptyTab") : t("empty")}</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("columns.name")}</TH>
              {showShop && <TH>{t("columns.shop")}</TH>}
              <TH>{t("columns.status")}</TH>
              <TH>{t("columns.date")}</TH>
              <TH className="text-right">{t("columns.sent")}</TH>
              <TH className="text-right">{t("columns.delivered")}</TH>
              <TH className="text-right">{t("columns.bookings")}</TH>
              <TH className="text-right">{t("columns.revenue")}</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((r) => (
              <TR key={r.campaign.id} className="hover:bg-subtle/60">
                <TD className="min-w-56">
                  <Link href={detailHref(r)} className="font-medium text-ink hover:underline">
                    {r.campaign.name}
                  </Link>
                  {r.campaign.segment_preset && (
                    <span className="block text-[12px] text-muted">{tPreset(`${r.campaign.segment_preset}.name`)}</span>
                  )}
                </TD>
                {showShop && (
                  <TD className="whitespace-nowrap text-ink-2">
                    <CompanyName name={r.companyName} />
                  </TD>
                )}
                <TD>
                  <CampaignStatusBadge status={r.campaign.status} />
                </TD>
                <TD className="whitespace-nowrap text-ink-2">
                  {formatDate(r.stats.sentAt ?? r.campaign.scheduled_at ?? r.campaign.created_at)}
                </TD>
                <TD className="tnum text-right">{formatInt(r.stats.sent)}</TD>
                <TD className="tnum text-right">{formatInt(r.stats.delivered)}</TD>
                <TD className="tnum text-right">{formatInt(r.stats.booked)}</TD>
                <TD className="tnum whitespace-nowrap text-right font-medium text-accent">
                  {formatCZK(r.stats.revenueMinor)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
