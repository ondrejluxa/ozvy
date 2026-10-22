import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CompanyProfileForm } from "@/components/admin/company-forms";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePageContext } from "@/lib/auth/context";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("companyForm.newCompany");
  return { title: t("title") };
}

/** Admin → Klienti → Nový klient (spec §6 F1 step 1). Real data only; the demo has fixed shops. */
export default async function NewCompanyPage() {
  if (env.DATA_SOURCE !== "supabase") notFound();
  await requirePageContext({ permission: "admin.access" }, "/admin/companies/new");
  const t = await getTranslations("companyForm.newCompany");
  const tNav = await getTranslations("admin.clients");
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        back={{ href: "/admin/companies", label: tNav("title") }}
      />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <CompanyProfileForm defaults={{ average_job_value_czk: "3500", status: "onboarding" }} />
        </CardContent>
      </Card>
    </>
  );
}
