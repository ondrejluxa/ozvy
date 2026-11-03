"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/inputs";
import { archiveSegmentAction, createSegmentAction, previewSegmentAction } from "@/lib/actions/segments";
import type { SegmentCounts } from "@/lib/db/supabase/segments";
import type { LifecycleStatus, ServiceCategory } from "@/lib/db/types";
import { formatDate } from "@/lib/domain/dates";
import { formatInt } from "@/lib/domain/money";
import type { SegmentBuilderInput } from "@/lib/domain/segments/schema";
import { SERVICE_CATEGORIES } from "@/lib/domain/service-labels";

const STATUSES: LifecycleStatus[] = ["active", "at_risk", "inactive", "reactivated"];
type Preview = SegmentCounts & { sample: { id: string; name: string; lastVisitAt: string | null }[] };

const num = (s: string) => (s.trim() === "" ? null : Number(s));

/**
 * "Nový segment": a form over the rule DSL (spec §12). Preview shows the
 * count after eligibility and contact rules, the exclusion reasons and five
 * sample customers; nothing is saved until "Uložit segment".
 */
export function SegmentBuilder({ companyId }: { companyId: string }) {
  const t = useTranslations("segments.builder");
  const tCategory = useTranslations("category");
  const tStatus = useTranslations("status");
  const tExcl = useTranslations("exclusions");
  const tErrors = useTranslations("errors");
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [nothingSince, setNothingSince] = useState(false);
  const [statuses, setStatuses] = useState<LifecycleStatus[]>([]);
  const [topSpend, setTopSpend] = useState("");
  const [minVisits, setMinVisits] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, startTransition] = useTransition();

  const builder = (): SegmentBuilderInput => ({
    lastVisitFromMonths: num(from),
    lastVisitToMonths: num(to),
    categories,
    nothingSince,
    statuses,
    topSpendPercent: num(topSpend),
    minVisits24m: num(minVisits),
  });
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const edited = () => setPreview(null);

  const runPreview = () =>
    startTransition(async () => {
      const res = await previewSegmentAction({ companyId, builder: builder() });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      setPreview(res.data);
    });

  const save = () =>
    startTransition(async () => {
      const res = await createSegmentAction({ companyId, name, builder: builder() });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      toast.success(t("saved"));
      setName("");
      setPreview(null);
    });

  return (
    <div className="space-y-5">
      {/* Any rule change invalidates the preview; the name field below does not. */}
      <div className="space-y-5" onChange={edited}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="seg-from">{t("from")}</Label>
            <Input id="seg-from" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seg-to">{t("to")}</Label>
            <Input id="seg-to" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
            <p className="text-[12px] text-muted">{t("toHint")}</p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-ink-2">{t("categories")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {SERVICE_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={categories.includes(c)}
                  onChange={() => setCategories(toggle(categories, c))}
                  className="size-4 accent-[var(--color-accent)]"
                />
                {tCategory(c)}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-1.5 pt-1 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={nothingSince}
              onChange={(e) => setNothingSince(e.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            {t("nothingSince")}
          </label>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-ink-2">{t("statuses")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={statuses.includes(s)}
                  onChange={() => setStatuses(toggle(statuses, s))}
                  className="size-4 accent-[var(--color-accent)]"
                />
                {tStatus(s)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="seg-top">{t("topSpend")}</Label>
            <Input id="seg-top" inputMode="numeric" value={topSpend} onChange={(e) => setTopSpend(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seg-visits">{t("minVisits")}</Label>
            <Input
              id="seg-visits"
              inputMode="numeric"
              value={minVisits}
              onChange={(e) => setMinVisits(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={runPreview} disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {t("preview")}
        </Button>
      </div>

      {preview && (
        <div className="space-y-4 rounded-lg border border-line bg-subtle/40 p-4" data-testid="segment-preview">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-[12px] text-muted">{t("matched")}</div>
              <div className="tnum text-lg font-semibold text-ink">{formatInt(preview.matched)}</div>
            </div>
            <div>
              <div className="text-[12px] text-muted">{t("eligible")}</div>
              <div className="tnum text-lg font-semibold text-accent" data-testid="preview-eligible">
                {formatInt(preview.eligible)}
              </div>
            </div>
          </div>
          {Object.keys(preview.excluded).length > 0 && (
            <ul className="space-y-0.5 text-[13px] text-ink-2">
              {Object.entries(preview.excluded).map(([reason, n]) => (
                <li key={reason}>
                  <span className="tnum font-medium">{formatInt(n ?? 0)}</span> {tExcl(reason)}
                </li>
              ))}
            </ul>
          )}
          {preview.sample.length > 0 && (
            <div>
              <div className="text-[12px] text-muted">{t("sample")}</div>
              <ul className="mt-1 text-sm text-ink">
                {preview.sample.map((c) => (
                  <li key={c.id}>
                    {c.name}
                    {c.lastVisitAt && <span className="text-[12px] text-muted"> · {formatDate(c.lastVisitAt)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="seg-name">{t("name")}</Label>
              <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} className="w-72" />
            </div>
            <Button type="button" variant="accent" onClick={save} disabled={pending || !name.trim()}>
              {t("save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ArchiveSegmentButton({ companyId, segmentId }: { companyId: string; segmentId: string }) {
  const t = useTranslations("segments.builder");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await archiveSegmentAction({ companyId, segmentId });
          if (!res.ok) toast.error(tErrors(res.error.code));
        })
      }
    >
      {t("archive")}
    </Button>
  );
}
