import { useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { CampaignStatus, ConversionStage, LifecycleStatus, MessageStatus } from "@/lib/db/types";
import { cn } from "@/lib/utils";

type Tone = NonNullable<BadgeProps["tone"]>;

const LIFECYCLE_TONE: Record<LifecycleStatus, Tone> = {
  active: "accent",
  at_risk: "warn",
  inactive: "neutral",
  reactivated: "accent",
  opted_out: "outline",
};

export function LifecycleBadge({ status }: { status: LifecycleStatus }) {
  const t = useTranslations("status");
  return (
    <Badge
      tone={LIFECYCLE_TONE[status]}
      className={cn(status === "reactivated" && "border-transparent bg-accent text-white")}
    >
      {t(status)}
    </Badge>
  );
}

const CAMPAIGN_TONE: Record<CampaignStatus, Tone> = {
  draft: "neutral",
  waiting_for_approval: "warn",
  scheduled: "neutral",
  sending: "info",
  active: "accent",
  paused: "warn",
  completed: "outline",
  cancelled: "outline",
  failed: "danger",
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const t = useTranslations("campaignStatus");
  return (
    <Badge tone={CAMPAIGN_TONE[status]}>
      {status === "active" || status === "sending" ? (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      ) : null}
      {t(status)}
    </Badge>
  );
}

const MESSAGE_TONE: Record<MessageStatus, Tone> = {
  queued: "neutral",
  sending: "info",
  sent: "neutral",
  delivered: "accent",
  undelivered: "danger",
  expired: "outline",
  failed: "danger",
  cancelled: "outline",
};

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  const t = useTranslations("messageStatus");
  return <Badge tone={MESSAGE_TONE[status]}>{t(status)}</Badge>;
}

const STAGE_TONE: Record<ConversionStage, Tone> = {
  contacted: "neutral",
  replied: "info",
  booked: "info",
  completed: "accent",
  lost: "outline",
  opted_out: "outline",
};

export function StageBadge({ stage }: { stage: ConversionStage }) {
  const t = useTranslations("stage");
  return (
    <Badge tone={STAGE_TONE[stage]} className={cn(stage === "completed" && "border-transparent bg-accent text-white")}>
      {t(stage)}
    </Badge>
  );
}

export function HealthDot({ health, label }: { health: "green" | "amber" | "red"; label: string }) {
  return (
    <span className="inline-flex items-center" title={label}>
      <span
        className={cn(
          "size-2.5 rounded-full",
          health === "green" ? "bg-accent" : health === "amber" ? "bg-[#d48a1a]" : "bg-danger",
        )}
        aria-hidden
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
