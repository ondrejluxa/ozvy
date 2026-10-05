"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2, Wand2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/inputs";
import { createCampaignAction, generateTemplateAction, rewriteTemplateAction } from "@/lib/actions/campaigns";
import { validateTemplate, type TemplateIssue } from "@/lib/ai/validate";
import type { getBuilderData } from "@/lib/db/queries";
import { EXCLUSION_REASONS } from "@/lib/domain/contact-rules/audience";
import { estimateCampaign } from "@/lib/domain/campaigns/estimates";
import { formatDateTime } from "@/lib/domain/dates";
import { PLACEHOLDERS, optOutToken, renderTemplate } from "@/lib/domain/messaging/render";
import { isWithinSendingWindow } from "@/lib/domain/messaging/sending-window";
import { countSmsSegments } from "@/lib/domain/messaging/sms-segments";
import { formatCZK, formatInt, formatPercent, roundEstimateMinor } from "@/lib/domain/money";
import { cn } from "@/lib/utils";
import { SmsPreview, type PreviewItem } from "./sms-preview";

type BuilderData = NonNullable<ReturnType<typeof getBuilderData>>;
export type BuilderStep = "segment" | "message" | "schedule" | "review";
const STEPS: BuilderStep[] = ["segment", "message", "schedule", "review"];
const BLOCKING: TemplateIssue["code"][] = ["unknown_placeholder", "missing_required"];
const OPT_OUT_BASE = "example.cz/o";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Deterministic preview sample: spread across the list, including one recipient without a vehicle if any. */
function previewSample<T extends { vehicleBrand: string | null }>(list: T[], size = 5): T[] {
  if (list.length <= size) return list;
  const picked = Array.from({ length: size }, (_, i) => list[Math.floor((i * list.length) / size)]);
  const missing = list.find((r) => !r.vehicleBrand);
  if (missing && !picked.includes(missing)) picked[size - 2] = missing;
  return picked;
}

export function CampaignBuilder({
  data,
  initialStep,
  defaultSendAt,
  defaultName,
  basePath,
}: {
  data: BuilderData;
  initialStep: BuilderStep;
  defaultSendAt: string;
  defaultName: string;
  basePath: string;
}) {
  const t = useTranslations("builder");
  const tPreset = useTranslations("presets");
  const tExcl = useTranslations("exclusions");
  const tUnavailable = useTranslations("presetUnavailable");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const [navPending, startNav] = useTransition();
  const [aiPending, startAi] = useTransition();
  const [submitPending, startSubmit] = useTransition();

  const [step, setStepState] = useState<BuilderStep>(initialStep);
  const [holdoutPct, setHoldoutPct] = useState(data.holdoutPct);
  const [variants, setVariants] = useState<string[]>([]);
  const [template, setTemplate] = useState("");
  const [strip, setStrip] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [name, setName] = useState(defaultName);
  const [sendAt, setSendAt] = useState(() => toLocalInput(new Date(defaultSendAt)));
  const [aiError, setAiError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const now = useMemo(() => new Date(data.now), [data.now]);
  const sel = data.selected;
  const estimate = estimateCampaign({
    eligible: sel.eligible,
    holdoutPct,
    conversionRate: data.conversionRate,
    avgJobValueMinor: sel.avgJobValueMinor,
  });

  const setStep = (next: BuilderStep) => {
    setStepState(next);
    // Shallow URL update (no server round trip) so the step survives a refresh
    // and the demo guide can follow along.
    const params = new URLSearchParams({ preset: data.presetKey, step: next });
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const choosePreset = (key: string) => {
    if (key === data.presetKey) return;
    startNav(() => router.replace(`${pathname}?preset=${key}&step=segment`, { scroll: false }));
  };

  // ---------- rendering & segment counting ----------
  const render = (r: BuilderData["recipients"][number], withStrip: boolean) =>
    renderTemplate(template, {
      recipient: r,
      shop: data.shop,
      optOutUrl: `${OPT_OUT_BASE}/${optOutToken(r.enrollmentKey)}`,
      now,
      stripDiacritics: withStrip,
    });

  const sample = useMemo(() => previewSample(data.recipients), [data.recipients]);
  const previewItems: PreviewItem[] = sample.map((r) => ({
    key: r.enrollmentKey,
    name: [r.firstName, r.lastName].filter(Boolean).join(" "),
    vehicle: r.vehicleBrand ? `${r.vehicleBrand} ${r.vehicleModel ?? ""}`.trim() : null,
    plate: r.plate,
    lastVisitAt: r.lastVisitAt,
    result: template ? render(r, strip) : null,
  }));
  const current = previewItems[previewIndex]?.result ?? null;
  const currentSeg = current ? countSmsSegments(current.text) : null;

  const totals = useMemo(() => {
    if (!template || data.recipients.length === 0) return null;
    const sum = (withStrip: boolean) =>
      data.recipients.reduce((acc, r) => acc + countSmsSegments(render(r, withStrip).text).segments, 0);
    const withDia = sum(false);
    const without = sum(true);
    const perRecipient = (strip ? without : withDia) / data.recipients.length;
    return {
      segments: Math.round(perRecipient * estimate.sendCount),
      saving: Math.max(
        0,
        Math.round(((withDia - without) / data.recipients.length) * estimate.sendCount * data.pricePerSegmentMinor),
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- render() depends only on these values
  }, [template, strip, data.recipients, estimate.sendCount, data.pricePerSegmentMinor]);

  const issues = template ? validateTemplate(template, { now }) : [];
  const blocking = issues.filter((i) => BLOCKING.includes(i.code));
  const sendDate = new Date(sendAt);
  const sendValid = !Number.isNaN(sendDate.getTime()) && isWithinSendingWindow(sendDate);

  const canContinue: Record<BuilderStep, boolean> = {
    segment: sel.eligible > 0 && !sel.unavailableReason,
    message: !!template && blocking.length === 0,
    schedule: sendValid && name.trim().length >= 3,
    review: true,
  };

  // ---------- AI actions ----------
  const generate = () =>
    startAi(async () => {
      setAiError(false);
      const res = await generateTemplateAction({ presetKey: data.presetKey });
      if (!res.ok) {
        setAiError(true);
        return;
      }
      setVariants(res.data.variants);
      setTemplate(res.data.variants[0]);
      setPreviewIndex(0);
    });

  const rewrite = (action: "shorter" | "friendlier" | "professional" | "regenerate") =>
    startAi(async () => {
      setAiError(false);
      const res = await rewriteTemplateAction({ presetKey: data.presetKey, current: template, action });
      if (!res.ok) {
        setAiError(true);
        return;
      }
      setTemplate(res.data.template);
    });

  const insertPlaceholder = (p: string) => {
    const el = textareaRef.current;
    const token = `{{${p}}}`;
    if (!el) {
      setTemplate((v) => `${v}${token}`);
      return;
    }
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    const next = `${template.slice(0, start)}${token}${template.slice(end)}`;
    setTemplate(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  // ---------- submit ----------
  const submit = () =>
    startSubmit(async () => {
      const res = await createCampaignAction({
        companyId: data.company.id,
        presetKey: data.presetKey,
        name: name.trim(),
        holdoutPct,
        template,
        stripDiacritics: strip,
        scheduledAt: sendDate.toISOString(),
      });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      router.push(`${basePath}/${res.data.campaignId}?sending=1`);
    });

  // ---------- UI ----------
  const stepIndex = STEPS.indexOf(step);

  return (
    <div>
      <ol className="mb-6 flex items-center gap-2 overflow-x-auto pb-1 text-[13px]">
        {STEPS.map((s, i) => (
          <li key={s} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={i > stepIndex && !STEPS.slice(0, i).every((p) => canContinue[p])}
              onClick={() => setStep(s)}
              className={cn(
                "flex items-center gap-2 rounded-full px-1 py-0.5 disabled:cursor-not-allowed",
                i === stepIndex ? "font-semibold text-ink" : i < stepIndex ? "text-accent" : "text-muted",
              )}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border text-[12px]",
                  i === stepIndex
                    ? "border-ink bg-ink text-white"
                    : i < stepIndex
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line-strong bg-surface",
                )}
              >
                {i < stepIndex ? <Check className="size-3.5" /> : i + 1}
              </span>
              {t(`steps.${s}`)}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-line-strong sm:w-10" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={cn("space-y-6 lg:col-span-2", navPending && "pointer-events-none opacity-60")}>
          {step === "segment" && (
            <>
              <Card>
                <CardContent className="space-y-5">
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">{tPreset(`${data.presetKey}.name`)}</h2>
                    <p className="mt-0.5 text-[13px] text-muted">{tPreset(`${data.presetKey}.description`)}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <div className="text-[12px] text-muted">{t("segment.eligible")}</div>
                      <div className="tnum text-2xl font-semibold text-ink">{formatInt(sel.eligible)}</div>
                    </div>
                    <div>
                      <div className="text-[12px] text-muted">{t("segment.excluded")}</div>
                      <div className="tnum text-2xl font-semibold text-muted">{formatInt(sel.excludedTotal)}</div>
                    </div>
                    <div>
                      <div className="text-[12px] text-muted">{t("segment.send")}</div>
                      <div className="tnum text-2xl font-semibold text-ink">{formatInt(estimate.sendCount)}</div>
                    </div>
                  </div>
                  {sel.excludedTotal > 0 && (
                    <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                      {EXCLUSION_REASONS.filter((r) => sel.excluded[r] > 0).map((r) => (
                        <li key={r} className="flex justify-between gap-3 border-b border-dashed border-line py-1">
                          <span className="text-ink-2">{tExcl(r)}</span>
                          <span className="tnum text-muted">{formatInt(sel.excluded[r])}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="holdout">{t("segment.holdout")}</Label>
                      <span className="tnum text-[13px] font-medium text-ink">
                        {t("segment.holdoutValue", {
                          pct: formatPercent(holdoutPct),
                          count: formatInt(estimate.holdout),
                        })}
                      </span>
                    </div>
                    <input
                      id="holdout"
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={Math.round(holdoutPct * 100)}
                      onChange={(e) => setHoldoutPct(Number(e.target.value) / 100)}
                      className="mt-2 w-full accent-[#0f7b53]"
                    />
                    <p className="mt-1 text-[12px] text-muted">{t("segment.holdoutHint")}</p>
                  </div>
                  <p className="text-[12px] text-muted">{t("segment.rulesNote")}</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <h2 className="text-[15px] font-semibold text-ink">{t("segment.other")}</h2>
                  <div className="mt-4 grid gap-2">
                    {data.presets.map((p) => {
                      const disabled = !!p.unavailableReason || p.eligible === 0;
                      const active = p.presetKey === data.presetKey;
                      return (
                        <button
                          key={p.presetKey}
                          type="button"
                          disabled={disabled}
                          onClick={() => choosePreset(p.presetKey)}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-md border px-3.5 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                            active
                              ? "border-accent bg-accent-soft/50 ring-1 ring-accent-line"
                              : "border-line hover:bg-subtle",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                              {tPreset(`${p.presetKey}.name`)}
                              {data.recommended === p.presetKey && (
                                <span className="rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-strong">
                                  {t("segment.recommended")}
                                </span>
                              )}
                            </span>
                            <span className="block text-[12px] text-muted">
                              {p.unavailableReason
                                ? tUnavailable(p.unavailableReason)
                                : tPreset(`${p.presetKey}.description`)}
                            </span>
                          </span>
                          <span className="tnum shrink-0 text-right text-[13px]">
                            <span className="block font-semibold text-ink">{formatInt(p.eligible)}</span>
                            <span className="text-[11px] text-muted">
                              {p.eligible
                                ? `~ ${formatCZK(roundEstimateMinor(p.expectedRevenueMinor))}`
                                : t("segment.unavailable")}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {step === "message" && (
            <Card>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[15px] font-semibold text-ink">{t("message.title")}</h2>
                  <Button variant={template ? "outline" : "accent"} onClick={generate} disabled={aiPending}>
                    {aiPending ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
                    {aiPending ? t("message.generating") : t("message.generate")}
                  </Button>
                </div>

                {!template && !aiPending && (
                  <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-[13px] leading-5 text-muted">
                    {t("message.emptyHint")}
                  </p>
                )}
                {aiError && <p className="text-[13px] text-danger">{t("message.error")}</p>}

                {variants.length > 0 && (
                  <div>
                    <div className="mb-2 text-[12px] font-medium text-muted">{t("message.variants")}</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      {variants.map((v, i) => {
                        const chosen = v === template;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setTemplate(v)}
                            className={cn(
                              "rounded-md border p-3 text-left text-[12px] leading-[18px] transition-colors",
                              chosen
                                ? "border-accent bg-accent-soft/40 ring-1 ring-accent-line"
                                : "border-line hover:bg-subtle",
                            )}
                          >
                            <span className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
                              {t(`message.variantLabels.${i}`)}
                              {chosen && <Check className="size-3.5 text-accent" aria-hidden />}
                            </span>
                            <span className="line-clamp-4 text-ink-2">{v.replace(/\{\{(\w+)\}\}/g, "[$1]")}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {template && (
                  <>
                    <div>
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="template">{t("message.editor")}</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {(["shorter", "friendlier", "professional", "regenerate"] as const).map((a) => (
                            <button
                              key={a}
                              type="button"
                              disabled={aiPending}
                              onClick={() => rewrite(a)}
                              className="rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[12px] text-ink-2 hover:bg-subtle disabled:opacity-50"
                            >
                              {t(`message.rewrite.${a}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Textarea
                        id="template"
                        ref={textareaRef}
                        value={template}
                        onChange={(e) => setTemplate(e.target.value)}
                        rows={5}
                        className="font-mono text-[13px]"
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] text-muted">{t("message.placeholders")}:</span>
                        {PLACEHOLDERS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => insertPlaceholder(p)}
                            className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:border-line-strong"
                          >
                            {t(`message.placeholderNames.${p}`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 rounded-md border border-line bg-subtle/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                        <input
                          type="checkbox"
                          checked={strip}
                          onChange={(e) => setStrip(e.target.checked)}
                          className="size-4 accent-[#0f7b53]"
                        />
                        {t("message.strip")}
                      </label>
                      {currentSeg && (
                        <div className="text-right text-[12px]">
                          <span
                            className={cn(
                              "tnum text-sm font-semibold",
                              currentSeg.segments <= 2 ? "text-accent" : "text-warn",
                            )}
                          >
                            {t("message.segments", { count: currentSeg.segments })}
                          </span>
                          <span className="block text-muted">
                            {currentSeg.encoding === "UCS-2" ? t("message.encodingUcs") : t("message.encodingGsm")} ·{" "}
                            {t("message.chars", { used: currentSeg.units, left: currentSeg.remaining })}
                          </span>
                        </div>
                      )}
                    </div>
                    {!strip && totals && totals.saving > 0 && (
                      <p className="-mt-2 text-[12px] text-muted">
                        {t("message.stripHint", { saving: formatCZK(totals.saving) })}
                      </p>
                    )}

                    {issues.length > 0 ? (
                      <ul className="space-y-1">
                        {issues.map((i, k) => (
                          <li
                            key={k}
                            className={cn(
                              "flex items-center gap-1.5 text-[13px]",
                              BLOCKING.includes(i.code) ? "text-danger" : "text-warn",
                            )}
                          >
                            <AlertTriangle className="size-3.5" aria-hidden />
                            {t(`message.issues.${i.code}`, { value: "value" in i ? String(i.value) : "" })}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="flex items-center gap-1.5 text-[13px] text-accent">
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        {t("message.optOutOk")}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {step === "schedule" && (
            <Card>
              <CardContent className="space-y-5">
                <h2 className="text-[15px] font-semibold text-ink">{t("schedule.title")}</h2>
                <div className="space-y-1.5">
                  <Label htmlFor="name">{t("schedule.name")}</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sendAt">{t("schedule.date")}</Label>
                  <Input
                    id="sendAt"
                    type="datetime-local"
                    value={sendAt}
                    onChange={(e) => setSendAt(e.target.value)}
                    className="max-w-64"
                  />
                  {!sendValid && <p className="text-[12px] text-danger">{t("schedule.outside")}</p>}
                  <p className="text-[12px] text-muted">{t("schedule.window")}</p>
                </div>
                <p className="rounded-md bg-info-soft px-3 py-2 text-[13px] text-info">{t("schedule.demoNote")}</p>
              </CardContent>
            </Card>
          )}

          {step === "review" && (
            <Card>
              <CardContent className="space-y-5">
                <h2 className="text-[15px] font-semibold text-ink">{t("review.title")}</h2>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[12px] text-muted">{t("review.segment")}</dt>
                    <dd className="font-medium text-ink">{tPreset(`${data.presetKey}.name`)}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">{t("review.sendAt")}</dt>
                    <dd className="tnum font-medium text-ink">{sendValid ? formatDateTime(sendDate) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">{t("review.recipients")}</dt>
                    <dd className="tnum font-medium text-ink">{formatInt(estimate.sendCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">{t("review.holdout")}</dt>
                    <dd className="tnum font-medium text-ink">
                      {formatInt(estimate.holdout)} ({formatPercent(holdoutPct)})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">{t("review.segments")}</dt>
                    <dd className="tnum font-medium text-ink">{totals ? formatInt(totals.segments) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">{t("review.cost")}</dt>
                    <dd className="tnum font-medium text-ink">
                      {totals ? formatCZK(totals.segments * data.pricePerSegmentMinor) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">{t("review.expected")}</dt>
                    <dd className="tnum font-semibold text-accent">
                      ~ {formatCZK(roundEstimateMinor(estimate.expectedRevenueMinor))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">{t("review.optOut")}</dt>
                    <dd className="flex items-center gap-1 font-medium text-accent">
                      <CheckCircle2 className="size-4" aria-hidden /> {t("review.yes")}
                    </dd>
                  </div>
                </dl>
                {!template && <p className="text-[13px] text-danger">{t("review.needTemplate")}</p>}
                <Button
                  variant="accent"
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={submit}
                  disabled={submitPending || !canContinue.message || !canContinue.schedule}
                >
                  {submitPending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
                  {submitPending ? t("review.submitting") : t("review.submit")}
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(STEPS[stepIndex - 1])} disabled={stepIndex === 0}>
              <ArrowLeft aria-hidden />
              {t("back")}
            </Button>
            {step !== "review" && (
              <Button onClick={() => setStep(STEPS[stepIndex + 1])} disabled={!canContinue[step]}>
                {t("next")}
                <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-12 lg:self-start">
          <Card>
            <CardContent className="space-y-3">
              <div>
                <div className="text-[12px] text-muted">{t("segment.expected")}</div>
                <div className="tnum text-2xl font-semibold text-accent">
                  ~ {formatCZK(roundEstimateMinor(estimate.expectedRevenueMinor))}
                </div>
                <div className="text-[12px] text-muted">
                  {t("segment.basis", {
                    rate: formatPercent(data.conversionRate),
                    avg: formatCZK(sel.avgJobValueMinor),
                  })}
                </div>
                <div className="mt-1 text-[12px] text-faint">
                  {t("segment.maxPotential", { value: formatCZK(estimate.maxPotentialMinor) })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                <div>
                  <div className="text-[12px] text-muted">{t("segment.send")}</div>
                  <div className="tnum font-semibold text-ink">{formatInt(estimate.sendCount)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-muted">{t("segment.holdout")}</div>
                  <div className="tnum font-semibold text-ink">{formatInt(estimate.holdout)}</div>
                </div>
                {totals && (
                  <>
                    <div>
                      <div className="text-[12px] text-muted">{t("review.segments")}</div>
                      <div className="tnum font-semibold text-ink">{formatInt(totals.segments)}</div>
                    </div>
                    <div>
                      <div className="text-[12px] text-muted">{t("review.cost")}</div>
                      <div className="tnum font-semibold text-ink">
                        {formatCZK(totals.segments * data.pricePerSegmentMinor)}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
          {template && step !== "segment" && (
            <div>
              <div className="mb-2 text-[12px] font-medium text-muted">{t("message.preview")}</div>
              <SmsPreview
                items={previewItems}
                index={previewIndex}
                onIndex={setPreviewIndex}
                senderName={data.company.default_sender_name ?? data.shop.shopName}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
