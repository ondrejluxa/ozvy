import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ProductBrand } from "@/components/shell/brand";
import { env } from "@/lib/env";

/** Sign-in, password reset, MFA and invitation pages. Demo mode has no login. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (env.DATA_SOURCE === "demo") redirect("/admin");
  const t = await getTranslations("auth");
  const tMeta = await getTranslations("meta");
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center sm:py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <ProductBrand product={tMeta("product")} area={t("layoutTagline")} />
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
