import { Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { openClientViewAction } from "@/lib/actions/demo";

export async function OpenClientViewButton({
  companyId,
  variant = "outline",
}: {
  companyId: string;
  variant?: "outline" | "accent";
}) {
  const t = await getTranslations("supportView");
  return (
    <form action={openClientViewAction.bind(null, companyId)}>
      <Button type="submit" variant={variant} size="sm">
        <Eye aria-hidden />
        {t("open")}
      </Button>
    </form>
  );
}
