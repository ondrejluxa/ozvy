import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OpenClientViewButton } from "@/components/admin/open-client-view-button";
import { CompanyName } from "@/components/demo/demo-labels";
import { TabsNav } from "@/components/shell/tabs-nav";
import { getCompanyBasics } from "@/lib/db/queries";
import { formatCZK } from "@/lib/domain/money";

export default async function CompanyLayout({ children, params }: LayoutProps<"/admin/companies/[companyId]">) {
  const { companyId } = await params;
  const basics = getCompanyBasics(companyId);
  if (!basics) notFound();
  const t = await getTranslations("company");
  const base = `/admin/companies/${companyId}`;

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink sm:text-[26px]">
            <CompanyName name={basics.company.name} />
          </h1>
          <p className="mt-1 text-sm text-muted">
            {basics.company.city} · {t("meta.customers", { count: basics.customers })} ·{" "}
            {t("meta.vehicles", { count: basics.vehicles })} ·{" "}
            {t("meta.plan", { plan: basics.planName ?? "—", price: formatCZK(basics.subscriptionMinor) })}
          </p>
        </div>
        <OpenClientViewButton companyId={companyId} />
      </div>
      <TabsNav
        tabs={[
          { href: base, label: t("tabs.overview"), exact: true },
          { href: `${base}/customers`, label: t("tabs.customers") },
          { href: `${base}/segments`, label: t("tabs.segments") },
          { href: `${base}/campaigns`, label: t("tabs.campaigns") },
        ]}
      />
      <div className="pt-6">{children}</div>
    </>
  );
}
