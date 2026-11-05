import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AttentionRequired } from "@/components/admin/attention-required";
import { ClientsTable } from "@/components/admin/clients-table";
import { HealthCheckButton } from "@/components/admin/health-check-button";
import { RealClientsTable } from "@/components/admin/real-clients-table";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { getAdminOverview } from "@/lib/db/queries";
import { getRealAdminOverview } from "@/lib/db/supabase/dashboard";
import { env } from "@/lib/env";
import { formatCZK, formatInt } from "@/lib/domain/money";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.overview");
  return { title: t("title") };
}

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin.overview");
  const tAlerts = await getTranslations("alerts");
  if (env.DATA_SOURCE === "supabase") return <RealOverview />;
  const data = getAdminOverview();
  const k = data.kpis;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t("activeClients")} value={formatInt(k.activeClients)} />
        <KpiCard label={t("mrr")} value={formatCZK(k.mrrMinor)} demo />
        <KpiCard label={t("messages")} value={formatInt(k.messagesThisMonth)} />
        <KpiCard label={t("revenue")} value={formatCZK(k.revenueThisMonthMinor)} accent demo />
        <KpiCard label={t("activeCampaigns")} value={formatInt(k.activeCampaigns)} />
        <KpiCard label={t("failures")} value={formatInt(k.failures7d)} />
      </div>

      <section className="mt-8">
        <SectionTitle>
          {tAlerts("title")}{" "}
          <span className="ml-1 text-[13px] font-normal text-muted">
            {tAlerts("count", { count: data.alerts.length })}
          </span>
        </SectionTitle>
        <AttentionRequired alerts={data.alerts} now={data.now} />
      </section>

      <section className="mt-8">
        <SectionTitle
          action={
            <Link href="/admin/companies" className="text-[13px] font-medium text-accent hover:underline">
              {t("allClients")}
            </Link>
          }
        >
          {t("clients")}
        </SectionTitle>
        <ClientsTable rows={data.clients} />
      </section>
    </>
  );
}

/** Operator overview on real data (spec §10): platform KPIs, Attention Required, clients by health. */
async function RealOverview() {
  const t = await getTranslations("admin.overview");
  const tAlerts = await getTranslations("alerts");
  const data = await getRealAdminOverview();
  const k = data.kpis;
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="admin-kpis">
        <KpiCard label={t("activeClients")} value={formatInt(k.activeClients)} />
        <KpiCard label={t("mrr")} value={formatCZK(k.mrrMinor)} />
        <KpiCard label={t("messages")} value={formatInt(k.messagesThisMonth)} />
        <KpiCard label={t("revenue")} value={formatCZK(k.revenueThisMonthMinor)} accent />
        <KpiCard label={t("activeCampaigns")} value={formatInt(k.activeCampaigns)} />
        <KpiCard label={t("failures")} value={formatInt(k.failures7d)} />
      </div>

      <section className="mt-8" data-testid="attention-required">
        <SectionTitle action={<HealthCheckButton />}>
          {tAlerts("title")}{" "}
          <span className="ml-1 text-[13px] font-normal text-muted">
            {tAlerts("count", { count: data.alerts.length })}
          </span>
        </SectionTitle>
        {data.lastCheckAt || data.alerts.length ? (
          <AttentionRequired alerts={data.alerts} now={data.lastCheckAt ? new Date(data.lastCheckAt) : new Date()} />
        ) : (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-muted">
            {tAlerts("neverChecked")}
          </p>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle
          action={
            <Link href="/admin/companies" className="text-[13px] font-medium text-accent hover:underline">
              {t("allClients")}
            </Link>
          }
        >
          {t("clients")}
        </SectionTitle>
        <RealClientsTable rows={data.clients} />
      </section>
    </>
  );
}
