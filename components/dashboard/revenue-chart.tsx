"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCZK } from "@/lib/domain/money";

export interface RevenuePoint {
  label: string;
  longLabel: string;
  revenue: number; // CZK
  subscription: number; // CZK
}

const ACCENT = "#0f7b53";
const SUBSCRIPTION = "#6b6b73";
const compact = new Intl.NumberFormat("cs-CZ", { notation: "compact", maximumFractionDigits: 0 });

/**
 * "Vrácené tržby po měsících" (spec §9): bars for attributed revenue, a thin
 * line for the subscription price on the same CZK axis, so ROI is visible
 * without reading numbers.
 */
export function RevenueChart({
  data,
  labels,
}: {
  data: RevenuePoint[];
  labels: { revenue: string; subscription: string };
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: ACCENT }} aria-hidden />
          {labels.revenue}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full" style={{ background: SUBSCRIPTION }} aria-hidden />
          {labels.subscription}
        </span>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#ecebe8" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "#e7e6e3" }}
              tick={{ fill: "#6b6b73", fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tick={{ fill: "#6b6b73", fontSize: 12 }}
              tickFormatter={(v: number) => compact.format(v)}
            />
            <Tooltip
              cursor={{ fill: "rgba(24,24,27,0.04)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as RevenuePoint;
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-md">
                    <div className="mb-1 font-medium text-ink">{p.longLabel}</div>
                    <div className="tnum flex justify-between gap-4 text-ink-2">
                      <span>{labels.revenue}</span>
                      <span className="font-semibold text-ink">{formatCZK(p.revenue * 100)}</span>
                    </div>
                    <div className="tnum flex justify-between gap-4 text-ink-2">
                      <span>{labels.subscription}</span>
                      <span>{formatCZK(p.subscription * 100)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="revenue" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
            <Line
              dataKey="subscription"
              type="step"
              stroke={SUBSCRIPTION}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
