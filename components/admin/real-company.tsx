import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CompanyName } from "@/components/demo/demo-labels";
import { TabsNav } from "@/components/shell/tabs-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompanyDetail, CompanyRecord, CompanyUsers } from "@/lib/db/supabase/companies";
import { resolveCompanySettings } from "@/lib/domain/company-settings";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";

/**
 * Operator's view of one real company (DATA_SOURCE=supabase): header with
 * counts, and the tabs that already read real data. Segments and
 * campaigns join in their slices (spec §40.9, §40.10).
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
          { href: `${base}/settings`, label: t("tabs.settings") },
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

// ---------- onboarding (spec §6 F1) ----------

export function profileDefaults(c: CompanyRecord): Record<string, string> {
  const hours = c.opening_hours as { note?: unknown } | null;
  return {
    name: c.name,
    ico: c.ico ?? "",
    dic: c.dic ?? "",
    address_line: c.address_line ?? "",
    city: c.city ?? "",
    postal_code: c.postal_code ?? "",
    contact_person: c.contact_person ?? "",
    phone: c.phone ? formatPhone(c.phone) : "",
    email: c.email ?? "",
    website: c.website ?? "",
    average_job_value_czk: String(Math.round(c.average_job_value_minor / 100)),
    default_sender_name: c.default_sender_name ?? "",
    opening_hours: typeof hours?.note === "string" ? hours.note : "",
    status: c.status,
    requires_client_approval: c.requires_client_approval ? "on" : "",
  };
}

export function settingsDefaults(raw: unknown): Record<string, string> {
  const s = resolveCompanySettings(raw);
  const pct = (v: number) => String(Math.round(v * 1000) / 10);
  return {
    active_max_months: String(s.lifecycle.active_max_months),
    at_risk_max_months: String(s.lifecycle.at_risk_max_months),
    max_lookback_months: String(s.max_lookback_months),
    attribution_window_days: String(s.attribution_window_days),
    holdout_percent: pct(s.holdout_pct),
    expected_conversion_percent: pct(s.expected_conversion_rate),
    gross_margin_percent: s.gross_margin_pct === null ? "" : pct(s.gross_margin_pct),
    message_shop_name: s.message_shop_name ?? "",
  };
}

export async function OnboardingChecklist({ company, users }: { company: CompanyRecord; users: CompanyUsers }) {
  const t = await getTranslations("companyForm.checklist");
  const steps = [
    { key: "profile", done: Boolean(company.ico && company.default_sender_name) },
    { key: "dpa", done: Boolean(company.dpa_signed_at) },
    {
      key: "owner",
      done: [...users.members, ...users.pending].some((u) => u.role === "shop_owner"),
    },
    { key: "sending", done: company.sending_enabled },
  ] as const;
  if (steps.every((s) => s.done)) return null;
  return (
    <Card className="max-w-2xl" data-testid="onboarding-checklist">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <Link
          href={`/admin/companies/${company.id}/settings`}
          className="text-[13px] font-medium text-accent hover:underline"
        >
          {t("open")}
        </Link>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {steps.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              {s.done ? (
                <CheckCircle2 className="size-4 text-accent" aria-hidden />
              ) : (
                <Circle className="size-4 text-faint" aria-hidden />
              )}
              <span className={s.done ? "text-ink-2" : "text-ink"}>{t(s.key)}</span>
              <span className="sr-only">{s.done ? t("done") : t("todo")}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
