import { getTranslations } from "next-intl/server";
import { ProductBrand } from "@/components/shell/brand";
import { MobileNav, Sidebar, type NavItem } from "@/components/shell/nav";
import { UserMenu } from "@/components/shell/user-menu";
import { requirePageContext } from "@/lib/auth/context";
import { env } from "@/lib/env";

/**
 * Operator app. With DATA_SOURCE=supabase it requires a platform admin with
 * TOTP MFA (aal2); the demo has no login.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requirePageContext({ permission: "admin.access" }, "/admin");
  const t = await getTranslations("nav");
  const tMeta = await getTranslations("meta");
  const items: NavItem[] = [
    { href: "/admin", label: t("admin.overview"), icon: "overview", exact: true },
    { href: "/admin/companies", label: t("admin.clients"), icon: "clients" },
    { href: "/admin/campaigns", label: t("admin.campaigns"), icon: "campaigns" },
    // Kill switch and queue health exist only with real sending.
    ...(env.DATA_SOURCE === "supabase"
      ? [{ href: "/admin/system", label: t("admin.system"), icon: "system" } satisfies NavItem]
      : []),
  ];
  const brand = <ProductBrand product={tMeta("product")} area={t("adminArea")} />;
  const footer = ctx.session ? (
    <UserMenu session={ctx.session} />
  ) : (
    <div className="text-[12px] text-muted">{t("operator")}</div>
  );

  return (
    <div className="flex flex-1">
      <Sidebar items={items} brand={brand} footer={footer} />
      <div className="min-w-0 flex-1">
        <MobileNav items={items} brand={brand} footer={footer} />
        <main className="mx-auto w-full max-w-6xl px-4 pb-48 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
