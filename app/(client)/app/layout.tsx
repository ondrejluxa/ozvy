import { Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ClientBrand } from "@/components/shell/brand";
import { MobileNav, Sidebar, type NavItem } from "@/components/shell/nav";
import { UserMenu } from "@/components/shell/user-menu";
import { requireClientCompany } from "@/lib/auth/client-company";
import { getSupportView } from "@/lib/auth/context";
import { exitClientViewAction } from "@/lib/actions/demo";
import { endSupportViewAction } from "@/lib/actions/support-view";
import { getCompanyBasics } from "@/lib/db/queries";
import { env } from "@/lib/env";

/**
 * Client app (/app). With DATA_SOURCE=supabase it serves the signed-in shop
 * user's own company (from their membership). In the demo it is the
 * operator's read-only support view of one shop, selected by a cookie.
 */
export default async function ClientLayout({ children }: LayoutProps<"/app">) {
  const t = await getTranslations("nav");
  const items: NavItem[] = [
    { href: "/app", label: t("client.overview"), icon: "overview", exact: true },
    { href: "/app/customers", label: t("client.customers"), icon: "customers" },
    { href: "/app/campaigns", label: t("client.campaigns"), icon: "campaigns" },
    { href: "/app/results", label: t("client.results"), icon: "results" },
  ];
  const main = <main className="mx-auto w-full max-w-6xl px-4 pb-48 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</main>;

  if (env.DATA_SOURCE === "supabase") {
    const { session, membership } = await requireClientCompany("/app");
    const brand = <ClientBrand name={membership.companyName} city={null} />;
    const footer = <UserMenu session={session} companyId={membership.companyId} />;
    const tView = await getTranslations("supportView");
    return (
      <div className="flex flex-1">
        <Sidebar items={items} brand={brand} footer={footer} />
        <div className="min-w-0 flex-1">
          <MobileNav items={items} brand={brand} footer={footer} />
          {membership.supportView && (
            <div
              className="sticky top-20 z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn-line bg-warn-soft px-4 py-2 text-[13px] text-warn lg:top-8"
              data-testid="support-view-banner"
            >
              <Eye className="size-4 shrink-0" aria-hidden />
              <span>
                {tView("banner", { company: membership.companyName })} ·{" "}
                <strong className="font-semibold">{tView("readOnly")}</strong>
              </span>
              <form action={endSupportViewAction}>
                <button type="submit" className="font-semibold underline underline-offset-2 hover:no-underline">
                  {tView("exit")}
                </button>
              </form>
            </div>
          )}
          {main}
        </div>
      </div>
    );
  }

  const view = await getSupportView();
  if (!view) redirect("/admin/companies");
  const basics = getCompanyBasics(view.companyId)!;
  const tView = await getTranslations("supportView");
  const brand = <ClientBrand name={basics.company.name} city={basics.company.city} />;

  return (
    <div className="flex flex-1">
      <Sidebar items={items} brand={brand} />
      <div className="min-w-0 flex-1">
        <MobileNav items={items} brand={brand} />
        <div className="sticky top-20 z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn-line bg-warn-soft px-4 py-2 text-[13px] text-warn lg:top-8">
          <Eye className="size-4 shrink-0" aria-hidden />
          <span>
            {tView("banner", { company: basics.company.name })} ·{" "}
            <strong className="font-semibold">{tView("readOnly")}</strong>
          </span>
          <form action={exitClientViewAction}>
            <button type="submit" className="font-semibold underline underline-offset-2 hover:no-underline">
              {tView("exit")}
            </button>
          </form>
        </div>
        {main}
      </div>
    </div>
  );
}
