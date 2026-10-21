import { getTranslations } from "next-intl/server";
import { CompanyName } from "@/components/demo/demo-labels";
import { TabsNav } from "@/components/shell/tabs-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompanyDetail } from "@/lib/db/supabase/companies";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";

/**
 * Operator's view of one real company (DATA_SOURCE=supabase): header with
 * counts, and the tabs that already read real data. Settings, segments and
 * campaigns join in their slices (spec §40.5, §40.9, §40.10).
 */
export async function RealCompanyHeader({ company }: { company: CompanyDetail }) {
  const t = await getTranslations("company");
  const tStatus = await getTranslations("realData.companies.statuses");
  const base = `/admin/companies/${company.id}`;
  return (
    <>
      <div className="mb-5 min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink sm:text-[26px]">
          <CompanyName name={company.name} />
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
          {company.city && <span>{company.city} ·</span>}
          <span>{t("meta.customers", { count: company.customers })} ·</span>
          <span>{t("meta.vehicles", { count: company.vehicles })}</span>
          <Badge tone={company.status === "active" ? "accent" : "neutral"} className="ml-1">
            {tStatus(company.status)}
          </Badge>
        </p>
      </div>
      <TabsNav
        tabs={[
          { href: base, label: t("tabs.overview"), exact: true },
          { href: `${base}/customers`, label: t("tabs.customers") },
        ]}
      />
    </>
  );
}

export async function RealCompanyProfile({ company: c }: { company: CompanyDetail }) {
  const t = await getTranslations("company.overview");
  const tCompanies = await getTranslations("realData.companies");
  const address = [c.addressLine, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t("profile")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{t("fields.ico")}</dt>
          <dd className="tnum">{c.ico ?? "—"}</dd>
          <dt className="text-muted">{t("fields.address")}</dt>
          <dd>{address || "—"}</dd>
          <dt className="text-muted">{t("fields.contact")}</dt>
          <dd>{c.contactPerson ?? "—"}</dd>
          <dt className="text-muted">{t("fields.phone")}</dt>
          <dd className="tnum">{c.phone ? formatPhone(c.phone) : "—"}</dd>
          <dt className="text-muted">{t("fields.email")}</dt>
          <dd className="break-all">{c.email ?? "—"}</dd>
          <dt className="text-muted">{t("fields.avgJob")}</dt>
          <dd className="tnum">{formatCZK(c.averageJobValueMinor)}</dd>
          <dt className="text-muted">{t("fields.sender")}</dt>
          <dd className="font-mono text-[13px]">{c.defaultSenderName ?? "—"}</dd>
          <dt className="text-muted">{t("fields.approval")}</dt>
          <dd>{c.requiresClientApproval ? t("fields.approvalClient") : t("fields.approvalOperator")}</dd>
          <dt className="text-muted">{tCompanies("sending")}</dt>
          <dd>{c.sendingEnabled ? tCompanies("sendingOn") : tCompanies("sendingOff")}</dd>
          <dt className="text-muted">{t("fields.dpa")}</dt>
          <dd>{c.dpaSignedAt ? t("fields.dpaSigned", { date: formatDate(c.dpaSignedAt) }) : "—"}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
