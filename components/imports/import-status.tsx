import { useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  uploaded: "neutral",
  parsing: "info",
  mapping: "warn",
  validating: "info",
  needs_review: "warn",
  committing: "info",
  completed: "accent",
  failed: "danger",
  cancelled: "outline",
};

export function ImportStatusBadge({ status }: { status: string }) {
  const t = useTranslations("imports.statuses");
  return <Badge tone={TONE[status] ?? "neutral"}>{t(status)}</Badge>;
}
