import { useTranslations } from "next-intl";
import type { LifecycleStatus } from "@/lib/db/types";
import { formatInt, formatPercent } from "@/lib/domain/money";

const ORDER: LifecycleStatus[] = ["active", "reactivated", "at_risk", "inactive", "opted_out"];
const COLOR: Record<LifecycleStatus, string> = {
  active: "bg-accent/55",
  reactivated: "bg-accent",
  at_risk: "bg-[#e0a43a]",
  inactive: "bg-line-strong",
  opted_out: "bg-subtle border border-line",
};

export function LifecycleBreakdown({ counts }: { counts: Record<LifecycleStatus, number> }) {
  const t = useTranslations("status");
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
        {ORDER.map((s) => (
          <div key={s} className={COLOR[s]} style={{ width: `${(counts[s] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {ORDER.map((s) => (
          <li key={s} className="flex items-start gap-2">
            <span className={`mt-1 size-2.5 shrink-0 rounded-sm ${COLOR[s]}`} aria-hidden />
            <span>
              <span className="block text-[12px] text-muted">{t(s)}</span>
              <span className="tnum text-sm font-semibold text-ink">{formatInt(counts[s])}</span>{" "}
              <span className="tnum text-[12px] text-faint">{formatPercent(counts[s] / total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
