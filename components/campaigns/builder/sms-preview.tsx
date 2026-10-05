"use client";

import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RenderResult } from "@/lib/domain/messaging/render";
import { formatDate } from "@/lib/domain/dates";

export interface PreviewItem {
  key: string;
  name: string;
  vehicle: string | null;
  plate: string | null;
  lastVisitAt: string | null;
  result: RenderResult | null;
}

/** Phone-style preview of the rendered SMS for one recipient, with a carousel. */
export function SmsPreview({
  items,
  index,
  onIndex,
  senderName,
}: {
  items: PreviewItem[];
  index: number;
  onIndex: (i: number) => void;
  senderName: string;
}) {
  const t = useTranslations("builder.message");
  const item = items[index];
  if (!item) return null;

  return (
    <div className="rounded-xl border border-line bg-subtle p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0 text-[12px]">
          <div className="truncate font-medium text-ink">{item.name}</div>
          <div className="truncate text-muted">
            {item.vehicle ?? "—"}
            {item.plate && <span className="font-mono"> · {item.plate}</span>}
            {item.lastVisitAt && <> · {formatDate(item.lastVisitAt)}</>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="←"
            onClick={() => onIndex((index - 1 + items.length) % items.length)}
            className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="tnum text-[12px] text-muted">
            {t("previewOf", { index: index + 1, total: items.length })}
          </span>
          <button
            type="button"
            aria-label="→"
            onClick={() => onIndex((index + 1) % items.length)}
            className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="rounded-lg bg-surface p-3 shadow-sm">
        <div className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide text-faint">{senderName}</div>
        {item.result ? (
          <p className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-subtle px-3.5 py-2.5 text-[14px] leading-5 text-ink">
            {item.result.text}
          </p>
        ) : (
          <p className="px-2 py-6 text-center text-[13px] text-faint">…</p>
        )}
      </div>
      {item.result && item.result.fallbacks.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 px-1 text-[12px] text-warn">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("fallback")}
        </p>
      )}
    </div>
  );
}
