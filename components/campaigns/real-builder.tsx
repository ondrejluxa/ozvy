"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { SmsPreview, type PreviewItem } from "@/components/campaigns/builder/sms-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/inputs";
import {
  chooseVariantAction,
  createCampaignRealAction,
  generateTemplateRealAction,
  rewriteTemplateRealAction,
  updateDraftAction,
} from "@/lib/actions/real-campaigns";
import { validateTemplate, type TemplateIssue } from "@/lib/ai/validate";
import type { RealBuilderData } from "@/lib/db/supabase/campaigns";
import { estimateCampaign } from "@/lib/domain/campaigns/estimates";
import { DEFAULT_FOLLOWUPS, MAX_FOLLOWUPS, MIN_FOLLOWUP_GAP_DAYS } from "@/lib/domain/campaigns/steps";
import { EXCLUSION_REASONS } from "@/lib/domain/contact-rules/audience";
import { addDays, formatDate, formatDateTime } from "@/lib/domain/dates";
import { PLACEHOLDERS, optOutToken, renderTemplate } from "@/lib/domain/messaging/render";
import { isWithinSendingWindow } from "@/lib/domain/messaging/sending-window";
import { countSmsSegments } from "@/lib/domain/messaging/sms-segments";
import { formatCZK, formatInt, formatPercent, roundEstimateMinor } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

type Step = "segment" | "message" | "schedule" | "review";
const STEPS: Step[] = ["segment", "message", "schedule", "review"];
const BLOCKING: TemplateIssue["code"][] = ["unknown_placeholder", "missing_required"];
const OPT_OUT_BASE = "example.cz/o";

interface MessageStep {
  delayDays: number;
  template: string;
  stripDiacritics: boolean;
}

export interface BuilderInitial {
  campaignId: string;
  name: string;
  holdoutPct: number;
  scheduledAt: string;
  steps: MessageStep[];
}

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Campaign builder on real data (spec §8 "Kampaň – builder", flow F3):
 * Segment → Zpráva (initial message + up to 2 follow-ups) → Načasování →
 * Kontrola. Recipients and counts come from the database; the browser only
 * renders previews. Creating a campaign re-checks everything on the server.
 */
export function RealCampaignBuilder({
  data,
  basePath,
  defaultName,
  defaultSendAt,
  initial,
}: {
  data: RealBuilderData;
  basePath: string;
  defaultName: string;
  defaultSendAt: string;
  initial?: BuilderInitial;
}) {
  const t = useTranslations("builder");
  const tc = useTranslations("campaignBuilder");
  const tPreset = useTranslations("presets");
  const tExcl = useTranslations("exclusions");
  const tUnavailable = useTranslations("presetUnavailable");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [aiPending, startAi] = useTransition();
  const [submitPending, startSubmit] = useTransition();

  const [step, setStep] = useState<Step>(initial ? "message" : "segment");
  const [holdoutPct, setHoldoutPct] = useState(initial?.holdoutPct ?? data.holdoutPct);
  const [steps, setSteps] = useState<MessageStep[]>(
    initial?.steps ?? [{ delayDays: 0, template: "", stripDiacritics: false }],
  );
  const [active, setActive] = useState(0);
  const [variants, setVariants] = useState<string[]>([]);
  // ai_generations rows of this session: linked to the campaign on save.
  const [generationIds, setGenerationIds] = useState<string[]>([]);
  const [variantGeneration, setVariantGeneration] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [name, setName] = useState(initial?.name ?? defaultName);
  const [sendAt, setSendAt] = useState(toLocalInput(new Date(initial?.scheduledAt ?? defaultSendAt)));
  const [confirmed, setConfirmed] = useState(false);

  const now = useMemo(() => new Date(data.now), [data.now]);
  const source = data.source;
  const sourceName = source.presetKey ? tPreset(`${source.presetKey}.name`) : (source.segmentName ?? "");
  const estimate = estimateCampaign({
    eligible: data.counts.eligible,
    holdoutPct,
    conversionRate: data.conversionRate,
    avgJobValueMinor: data.avgJobValueMinor,
  });
  const excludedTotal = Object.values(data.counts.excluded).reduce((a, b) => a + (b ?? 0), 0);

  const current = steps[active];
  const updateStep = (patch: Partial<MessageStep>) =>
    setSteps((list) => list.map((s, i) => (i === active ? { ...s, ...patch } : s)));

  // ---------- rendering ----------
  const render = (r: RealBuilderData["recipients"][number], template: string, strip: boolean) =>
    renderTemplate(template, {
      recipient: r,
      shop: data.shop,
      optOutUrl: `${OPT_OUT_BASE}/${optOutToken(r.enrollmentKey)}`,
      now,
      stripDiacritics: strip,
    });
  const sample = useMemo(() => {
    const list = data.recipients;
    if (list.length <= 5) return list;
    const picked = Array.from({ length: 5 }, (_, i) => list[Math.floor((i * list.length) / 5)]);
    const missing = list.find((r) => !r.vehicleBrand);
    if (missing && !picked.includes(missing)) picked[4] = missing;
    return picked;
  }, [data.recipients]);
  const previewItems: PreviewItem[] = sample.map((r) => ({
    key: r.enrollmentKey,
    name: [r.firstName, r.lastName].filter(Boolean).join(" "),
    vehicle: r.vehicleBrand ? `${r.vehicleBrand} ${r.vehicleModel ?? ""}`.trim() : null,
    plate: r.plate,
    lastVisitAt: r.lastVisitAt,
    result: current.template ? render(r, current.template, current.stripDiacritics) : null,
  }));
  const currentSeg = previewItems[previewIndex]?.result
    ? countSmsSegments(previewItems[previewIndex].result!.text)
    : null;

  // Average segments per recipient for every step, scaled to the send count.
  const totalSegments = useMemo(() => {
    if (data.recipients.length === 0) return 0;
    return steps.reduce((sum, s) => {
      if (!s.template) return sum;
      const per =
        data.recipients.reduce(
          (acc, r) => acc + countSmsSegments(render(r, s.template, s.stripDiacritics).text).segments,
          0,
        ) / data.recipients.length;
      return sum + Math.round(per * estimate.sendCount);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- render() depends only on these values
  }, [steps, data.recipients, estimate.sendCount]);

  const issuesByStep = steps.map((s) => (s.template ? validateTemplate(s.template, { now }) : []));
  const blocking = steps.some((s, i) => !s.template || issuesByStep[i].some((x) => BLOCKING.includes(x.code)));
  const gapsOk = steps.every((s, i) => i === 0 || s.delayDays - steps[i - 1].delayDays >= MIN_FOLLOWUP_GAP_DAYS);
  const sendDate = new Date(sendAt);
  const sendValid =
    !Number.isNaN(sendDate.getTime()) && sendDate.getTime() > now.getTime() && isWithinSendingWindow(sendDate);

  const canContinue: Record<Step, boolean> = {
    segment: data.counts.eligible > 0 && !source.unavailableReason,
    message: !blocking && gapsOk,
    schedule: sendValid && name.trim().length >= 3,
    review: true,
  };

  // ---------- AI (initial message only; follow-ups start from defaults) ----------
  const generate = () =>
    startAi(async () => {
      const res = await generateTemplateRealAction({
        companyId: data.companyId,
        presetKey: source.presetKey,
        campaignId: initial?.campaignId ?? null,
      });
      if (!res.ok) {
        toast.error(aiError(res.error.code));
        return;
      }
      const id = res.data.generationId;
      if (id) setGenerationIds((ids) => [...ids, id]);
      setVariantGeneration(id);
      setVariants(res.data.variants);
      updateStep({ template: res.data.variants[0] });
    });
  const rewrite = (action: "shorter" | "friendlier" | "professional" | "regenerate") =>
    startAi(async () => {
      const res = await rewriteTemplateRealAction({
        companyId: data.companyId,
        presetKey: source.presetKey,
        current: current.template,
        action,
        campaignId: initial?.campaignId ?? null,
      });
      if (!res.ok) {
        toast.error(aiError(res.error.code));
        return;
      }
      const id = res.data.generationId;
      if (id) setGenerationIds((ids) => [...ids, id]);
      updateStep({ template: res.data.template });
    });

  const aiError = (code: string) =>
    code === "ai_invalid_output" || code === "ai_unavailable" ? tErrors(code) : t("message.error");
  const chooseVariant = (i: number) => {
    updateStep({ template: variants[i] });
    if (variantGeneration) {
      void chooseVariantAction({ companyId: data.companyId, generationId: variantGeneration, index: i });
    }
  };

  const addFollowup = () => {
    if (steps.length > MAX_FOLLOWUPS) return;
    const delay = steps.length === 1 ? 3 : steps[steps.length - 1].delayDays + 4;
    setSteps([
      ...steps,
      { delayDays: delay, template: DEFAULT_FOLLOWUPS[steps.length - 1], stripDiacritics: steps[0].stripDiacritics },
    ]);
    setActive(steps.length);
  };
  const removeFollowup = (i: number) => {
    setSteps(steps.filter((_, k) => k !== i));
    setActive(0);
  };

  // ---------- save ----------
  const save = (submit: boolean) =>
    startSubmit(async () => {
      const content = { name: name.trim(), holdoutPct, steps, scheduledAt: sendDate.toISOString() };
      const res = initial
        ? await updateDraftAction({ companyId: data.companyId, campaignId: initial.campaignId, ...content })
        : await createCampaignRealAction({
            companyId: data.companyId,
            presetKey: source.presetKey,
            segmentId: source.segmentId,
            submit,
            generationIds,
            ...content,
          });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      const id = initial?.campaignId ?? (res.data as { campaignId: string }).campaignId;
      toast.success(
        submit ? (data.requiresClientApproval ? tc("sentForApproval") : tc("scheduled")) : tc("savedDraft"),
      );
      router.push(`${basePath}/${id}`);
    });

  const stepIndex = STEPS.indexOf(step);
  const go = (next: Step) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      <ol className="mb-6 flex items-center gap-2 overflow-x-auto pb-1 text-[13px]">
        {STEPS.map((s, i) => (
          <li key={s} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={i > stepIndex && !STEPS.slice(0, i).every((p) => canContinue[p])}
              onClick={() => go(s)}
              className={cn(
                "rounded-full px-2 py-0.5 disabled:cursor-not-allowed",
                i === stepIndex ? "bg-ink font-semibold text-white" : i < stepIndex ? "text-accent" : "text-muted",
              )}
            >
              {i + 1}. {t(`steps.${s}`)}
            </button>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {step === "segment" && (
            <Card>
              <CardContent className="space-y-5 pt-5">
                <div>
                  <h2 className="text-[15px] font-semibold text-ink" data-testid="builder-segment">
                    {sourceName}
                  </h2>
                  {source.presetKey && (
                    <p className="mt-0.5 text-[13px] text-muted">{tPreset(`${source.presetKey}.description`)}</p>
                  )}
                  {source.unavailableReason && (
                    <p className="mt-2 text-[13px] text-warn">{tUnavailable(source.unavailableReason)}</p>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Figure
                    label={t("segment.eligible")}
                    value={formatInt(data.counts.eligible)}
                    testId="builder-eligible"
                  />
                  <Figure label={t("segment.excluded")} value={formatInt(excludedTotal)} muted />
                  <Figure label={t("segment.send")} value={formatInt(estimate.sendCount)} testId="builder-send" />
                </div>
                {excludedTotal > 0 && (
                  <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                    {EXCLUSION_REASONS.filter((r) => (data.counts.excluded[r] ?? 0) > 0).map((r) => (
                      <li key={r} className="flex justify-between gap-3 border-b border-dashed border-line py-1">
                        <span className="text-ink-2">{tExcl(r)}</span>
                        <span className="tnum text-muted">{formatInt(data.counts.excluded[r] ?? 0)}</span>
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
                    className="mt-2 w-full accent-[var(--color-accent)]"
                  />
                  <p className="mt-1 text-[12px] text-muted">{t("segment.holdoutHint")}</p>
                </div>
                <div className="rounded-md bg-accent-soft px-4 py-3">
                  <div className="text-[12px] text-accent">{t("segment.expected")}</div>
                  <div className="tnum text-xl font-semibold text-accent" data-testid="builder-expected">
                    ~ {formatCZK(roundEstimateMinor(estimate.expectedRevenueMinor))}
                  </div>
                  <p className="text-[12px] text-ink-2">
                    {t("segment.basis", {
                      rate: formatPercent(data.conversionRate),
                      avg: formatCZK(data.avgJobValueMinor),
                    })}{" "}
                    · {t("segment.maxPotential", { value: formatCZK(estimate.maxPotentialMinor) })}
                  </p>
                </div>
                <p className="text-[12px] text-muted">{t("segment.rulesNote")}</p>

                {!initial && (
                  <div className="space-y-2 border-t border-line pt-4">
                    <div className="text-[13px] font-medium text-ink-2">{t("segment.other")}</div>
                    <div className="flex flex-wrap gap-2">
                      {data.options.presets.map((p) => (
                        <Link
                          key={p.key}
                          href={`?preset=${p.key}`}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-[12px]",
                            p.key === source.presetKey
                              ? "border-ink bg-ink text-white"
                              : "border-line text-ink-2 hover:bg-subtle",
                          )}
                        >
                          {tPreset(`${p.key}.name`)}{" "}
                          <span className="tnum opacity-75">{p.eligible === null ? "—" : formatInt(p.eligible)}</span>
                        </Link>
                      ))}
                      {data.options.segments.map((s) => (
                        <Link
                          key={s.id}
                          href={`?segment=${s.id}`}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-[12px]",
                            s.id === source.segmentId
                              ? "border-ink bg-ink text-white"
                              : "border-line text-ink-2 hover:bg-subtle",
                          )}
                        >
                          {s.name} <span className="tnum opacity-75">{formatInt(s.eligible)}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {step === "message" && (
            <Card>
              <CardContent className="space-y-4 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  {steps.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setActive(i);
                        setPreviewIndex(0);
                      }}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-[13px]",
                        i === active ? "border-ink bg-ink text-white" : "border-line text-ink-2",
                      )}
                    >
                      {i === 0 ? tc("initial") : tc("followup", { n: i, days: s.delayDays })}
                    </button>
                  ))}
                  {steps.length <= MAX_FOLLOWUPS && (
                    <Button type="button" variant="ghost" size="sm" onClick={addFollowup}>
                      <Plus aria-hidden />
                      {tc("addFollowup")}
                    </Button>
                  )}
                </div>

                {active > 0 && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="delay">{tc("delay")}</Label>
                      <Input
                        id="delay"
                        type="number"
                        min={2}
                        max={60}
                        value={current.delayDays}
                        onChange={(e) => updateStep({ delayDays: Number(e.target.value) })}
                        className="w-28"
                      />
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeFollowup(active)}>
                      <Trash2 aria-hidden />
                      {tc("removeFollowup")}
                    </Button>
                    {!gapsOk && <p className="text-[12px] text-danger">{tc("gap")}</p>}
                  </div>
                )}

                {active === 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="accent" onClick={generate} disabled={aiPending}>
                      {aiPending ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
                      {aiPending ? t("message.generating") : t("message.generate")}
                    </Button>
                    {current.template &&
                      (["shorter", "friendlier", "professional", "regenerate"] as const).map((a) => (
                        <Button
                          key={a}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={aiPending}
                          onClick={() => rewrite(a)}
                        >
                          {t(`message.rewrite.${a}`)}
                        </Button>
                      ))}
                  </div>
                )}
                {active === 0 && variants.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {variants.map((_v, i) => (
                      <Button key={i} type="button" variant="ghost" size="sm" onClick={() => chooseVariant(i)}>
                        {t(`message.variantLabels.${i as 0 | 1 | 2}`)}
                      </Button>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="template">{t("message.editor")}</Label>
                  <Textarea
                    id="template"
                    value={current.template}
                    onChange={(e) => updateStep({ template: e.target.value })}
                    placeholder={t("message.emptyHint")}
                    maxLength={640}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDERS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => updateStep({ template: `${current.template}{{${p}}}` })}
                        className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
                      >
                        {t(`message.placeholderNames.${p}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={current.stripDiacritics}
                    onChange={(e) => updateStep({ stripDiacritics: e.target.checked })}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {t("message.strip")}
                </label>
                {currentSeg && (
                  <p className="text-[12px] text-muted">
                    <span className={cn("font-semibold", currentSeg.segments <= 2 ? "text-accent" : "text-warn")}>
                      {t("message.segments", { count: currentSeg.segments })}
                    </span>{" "}
                    · {t("message.chars", { used: currentSeg.units, left: currentSeg.remaining })}
                  </p>
                )}
                {issuesByStep[active].length > 0 ? (
                  <ul className="space-y-1">
                    {issuesByStep[active].map((i, k) => (
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
                  current.template && (
                    <p className="flex items-center gap-1.5 text-[13px] text-accent">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {t("message.optOutOk")}
                    </p>
                  )
                )}
              </CardContent>
            </Card>
          )}

          {step === "schedule" && (
            <Card>
              <CardContent className="space-y-5 pt-5">
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
                {steps.length > 1 && sendValid && (
                  <ul className="space-y-1 text-[13px] text-ink-2">
                    {steps.map((s, i) => (
                      <li key={i}>
                        {i === 0 ? tc("initial") : tc("followup", { n: i, days: s.delayDays })}:{" "}
                        <span className="tnum">{formatDate(addDays(sendDate, s.delayDays))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {step === "review" && (
            <Card>
              <CardContent className="space-y-5 pt-5">
                <h2 className="text-[15px] font-semibold text-ink">{t("review.title")}</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-muted">{t("review.segment")}</dt>
                  <dd>{sourceName}</dd>
                  <dt className="text-muted">{t("review.recipients")}</dt>
                  <dd className="tnum">{formatInt(estimate.sendCount)}</dd>
                  <dt className="text-muted">{t("review.holdout")}</dt>
                  <dd className="tnum">{formatInt(estimate.holdout)}</dd>
                  <dt className="text-muted">{tc("steps")}</dt>
                  <dd className="tnum">{steps.length}</dd>
                  <dt className="text-muted">{t("review.segments")}</dt>
                  <dd className="tnum">{formatInt(totalSegments)}</dd>
                  <dt className="text-muted">{t("review.cost")}</dt>
                  <dd className="tnum" data-testid="builder-cost">
                    {formatCZK(totalSegments * data.pricePerSegmentMinor)}
                  </dd>
                  <dt className="text-muted">{t("review.expected")}</dt>
                  <dd className="tnum font-medium text-accent">
                    ~ {formatCZK(roundEstimateMinor(estimate.expectedRevenueMinor))}
                  </dd>
                  <dt className="text-muted">{t("review.optOut")}</dt>
                  <dd>{t("review.yes")}</dd>
                  <dt className="text-muted">{t("review.sendAt")}</dt>
                  <dd className="tnum">{formatDateTime(sendDate)}</dd>
                </dl>
                <p className="rounded-md bg-info-soft px-3 py-2 text-[13px] text-info">
                  {data.requiresClientApproval ? tc("approvalNote") : tc("operatorNote")}
                </p>
                {!data.requiresClientApproval && !initial && (
                  <label className="flex items-start gap-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-0.5 size-4 accent-[var(--color-accent)]"
                    />
                    <span>{tc("confirm", { count: estimate.sendCount, date: formatDateTime(sendDate) })}</span>
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  {!initial && (
                    <Button
                      type="button"
                      variant="accent"
                      disabled={submitPending || (!data.requiresClientApproval && !confirmed)}
                      onClick={() => save(true)}
                    >
                      {submitPending && <Loader2 className="animate-spin" aria-hidden />}
                      {data.requiresClientApproval ? tc("submitForApproval") : tc("schedule")}
                    </Button>
                  )}
                  <Button type="button" variant="outline" disabled={submitPending} onClick={() => save(false)}>
                    {initial ? tc("saveChanges") : tc("saveDraft")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-between">
            <Button type="button" variant="ghost" disabled={stepIndex === 0} onClick={() => go(STEPS[stepIndex - 1])}>
              <ArrowLeft aria-hidden />
              {t("back")}
            </Button>
            {stepIndex < STEPS.length - 1 && (
              <Button
                type="button"
                variant="outline"
                disabled={!canContinue[step]}
                onClick={() => go(STEPS[stepIndex + 1])}
              >
                {t("next")}
                <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
        </div>

        <aside className="space-y-3">
          {step === "message" && previewItems.length > 0 && current.template && (
            <SmsPreview
              items={previewItems}
              index={previewIndex}
              onIndex={setPreviewIndex}
              senderName={data.senderName}
            />
          )}
          {step === "message" && previewItems.length > 0 && current.template && (
            <p className="text-[12px] text-muted">{t("message.preview")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Figure({ label, value, muted, testId }: { label: string; value: string; muted?: boolean; testId?: string }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn("tnum text-2xl font-semibold", muted ? "text-muted" : "text-ink")} data-testid={testId}>
        {value}
      </div>
    </div>
  );
}
