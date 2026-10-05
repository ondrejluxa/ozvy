import { DemoTag } from "@/components/demo/demo-labels";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  accent = false,
  demo = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: boolean;
  demo?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        {demo && <DemoTag />}
      </div>
      <div
        className={cn(
          "tnum mt-1.5 text-[22px] font-semibold leading-7 tracking-tight",
          accent ? "text-accent" : "text-ink",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}
