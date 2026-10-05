import { getTranslations } from "next-intl/server";
import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listVisibleCompanies } from "@/lib/db/supabase/companies";
import { formatDate } from "@/lib/domain/dates";

/** Real companies list (DATA_SOURCE=supabase). Detail pages and creation follow in later slices. */
export async function RealCompaniesTable() {
  const t = await getTranslations("realData.companies");
  const companies = await listVisibleCompanies();
  if (companies.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
        {t("empty")}
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <Table>
        <THead>
          <TR>
            <TH>{t("name")}</TH>
            <TH>{t("status")}</TH>
            <TH>{t("sending")}</TH>
            <TH>{t("created")}</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {companies.map((c) => (
            <TR key={c.id}>
              <TD>
                <span className="font-medium text-ink">{c.name}</span>
                {c.city && <span className="block text-[12px] text-muted">{c.city}</span>}
              </TD>
              <TD>
                <Badge tone={c.status === "active" ? "accent" : "neutral"}>{t(`statuses.${c.status}`)}</Badge>
              </TD>
              <TD className="text-ink-2">{c.sendingEnabled ? t("sendingOn") : t("sendingOff")}</TD>
              <TD className="tnum whitespace-nowrap text-ink-2">{formatDate(c.createdAt)}</TD>
              <TD className="text-right">
                <InviteUserDialog companyId={c.id} companyName={c.name} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
