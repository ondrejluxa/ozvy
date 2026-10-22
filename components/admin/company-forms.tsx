"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/inputs";
import {
  confirmDpaAction,
  createCompanyAction,
  setSendingEnabledAction,
  updateCompanyProfileAction,
  updateCompanySettingsAction,
  type CompanyFormState,
} from "@/lib/actions/companies";
import { COMPANY_STATUSES } from "@/lib/domain/company-profile";

/**
 * Operator forms for one company (spec §6 F1). Plain forms posting to server
 * actions; field errors come back as codes (companyForm.errors.*) and the
 * submitted values are kept.
 */

type Values = Record<string, string>;

function Field({
  name,
  state,
  defaults,
  hint,
  className,
  ...props
}: {
  name: string;
  state: CompanyFormState;
  defaults: Values;
  hint?: string;
} & React.ComponentProps<typeof Input>) {
  const t = useTranslations("companyForm");
  const error = state.fieldErrors?.[name];
  const id = `company-${name}`;
  return (
    <div className={className ?? "space-y-1.5"}>
      <Label htmlFor={id}>{t(`fields.${name}`)}</Label>
      <Input
        id={id}
        name={name}
        defaultValue={state.values?.[name] ?? defaults[name] ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-[12px] text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : (
        hint && <p className="text-[12px] text-muted">{hint}</p>
      )}
    </div>
  );
}

function FormFooter({ pending, state, label }: { pending: boolean; state: CompanyFormState; label: string }) {
  const t = useTranslations("companyForm");
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <Button type="submit" variant="accent" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? t("saving") : label}
      </Button>
      {state.error && (
        <p role="alert" className="text-[13px] text-danger">
          {t(`errors.${state.error}`)}
        </p>
      )}
      {state.fieldErrors && (
        <p role="alert" className="text-[13px] text-danger">
          {t("fixErrors")}
        </p>
      )}
    </div>
  );
}

function useSavedToast(state: CompanyFormState) {
  const t = useTranslations("companyForm");
  useEffect(() => {
    if (state.done) toast.success(t("saved"));
  }, [state, t]);
}

// ---------- profile ----------

export function CompanyProfileForm({ companyId, defaults }: { companyId?: string; defaults: Values }) {
  const t = useTranslations("companyForm");
  const tStatus = useTranslations("realData.companies.statuses");
  const [state, action, pending] = useActionState(
    companyId ? updateCompanyProfileAction : createCompanyAction,
    {} as CompanyFormState,
  );
  useSavedToast(state);
  const status = state.values?.status ?? defaults.status ?? "onboarding";
  const approval = (state.values?.requires_client_approval ?? defaults.requires_client_approval) === "on";
  const f = { state, defaults };

  return (
    <form action={action} className="space-y-5" noValidate>
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="name" {...f} required className="space-y-1.5 sm:col-span-2" />
        <Field name="ico" {...f} inputMode="numeric" hint={t("hints.ico")} />
        <Field name="dic" {...f} />
        <Field name="address_line" {...f} className="space-y-1.5 sm:col-span-2" />
        <Field name="postal_code" {...f} inputMode="numeric" />
        <Field name="city" {...f} />
        <Field name="contact_person" {...f} />
        <Field name="phone" {...f} type="tel" />
        <Field name="email" {...f} type="email" />
        <Field name="website" {...f} />
        <Field
          name="average_job_value_czk"
          {...f}
          inputMode="numeric"
          required
          hint={t("hints.average_job_value_czk")}
        />
        <Field name="default_sender_name" {...f} maxLength={11} hint={t("hints.default_sender_name")} />
        <Field
          name="opening_hours"
          {...f}
          placeholder={t("hints.opening_hours")}
          className="space-y-1.5 sm:col-span-2"
        />
        <div className="space-y-1.5">
          <Label htmlFor="company-status">{t("fields.status")}</Label>
          <Select id="company-status" name="status" defaultValue={status}>
            {COMPANY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-start gap-2 self-end pb-2 text-sm text-ink-2">
          <input
            type="checkbox"
            name="requires_client_approval"
            defaultChecked={approval}
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />
          <span>{t("fields.requires_client_approval")}</span>
        </label>
      </div>
      <FormFooter pending={pending} state={state} label={companyId ? t("save") : t("create")} />
    </form>
  );
}

// ---------- settings ----------

export function CompanySettingsForm({ companyId, defaults }: { companyId: string; defaults: Values }) {
  const t = useTranslations("companyForm");
  const [state, action, pending] = useActionState(updateCompanySettingsAction, {} as CompanyFormState);
  useSavedToast(state);
  const f = { state, defaults, inputMode: "decimal" as const };
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="active_max_months" {...f} hint={t("hints.active_max_months")} />
        <Field name="at_risk_max_months" {...f} hint={t("hints.at_risk_max_months")} />
        <Field name="max_lookback_months" {...f} hint={t("hints.max_lookback_months")} />
        <Field name="attribution_window_days" {...f} hint={t("hints.attribution_window_days")} />
        <Field name="holdout_percent" {...f} hint={t("hints.holdout_percent")} />
        <Field name="expected_conversion_percent" {...f} hint={t("hints.expected_conversion_percent")} />
        <Field name="gross_margin_percent" {...f} hint={t("hints.gross_margin_percent")} />
        <Field name="message_shop_name" {...f} inputMode="text" hint={t("hints.message_shop_name")} />
      </div>
      <FormFooter pending={pending} state={state} label={t("save")} />
    </form>
  );
}

// ---------- DPA ----------

export function DpaForm({ companyId }: { companyId: string }) {
  const t = useTranslations("companyForm");
  const [state, action, pending] = useActionState(confirmDpaAction, {} as CompanyFormState);
  useSavedToast(state);
  const fileError = state.fieldErrors?.file;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="space-y-1.5">
        <Label htmlFor="dpa-file">{t("dpa.file")}</Label>
        <Input id="dpa-file" name="file" type="file" accept="application/pdf" className="h-auto py-1.5" />
        <p className={fileError ? "text-[12px] text-danger" : "text-[12px] text-muted"}>
          {fileError ? t(`errors.dpa_${fileError}`) : t("dpa.fileHint")}
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm text-ink-2">
        <input type="checkbox" name="confirmed" className="mt-0.5 size-4 accent-[var(--color-accent)]" />
        <span>{t("dpa.confirm")}</span>
      </label>
      {state.fieldErrors?.confirmed && <p className="text-[12px] text-danger">{t("errors.dpa_confirm_required")}</p>}
      <FormFooter pending={pending} state={{ ...state, fieldErrors: undefined }} label={t("dpa.submit")} />
    </form>
  );
}

// ---------- sending switch ----------

export function SendingSwitch({
  companyId,
  enabled,
  blocker,
}: {
  companyId: string;
  enabled: boolean;
  blocker: string | null;
}) {
  const t = useTranslations("companyForm.sending");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(enabled);

  const toggle = () =>
    startTransition(async () => {
      const res = await setSendingEnabledAction({ companyId, enabled: !on });
      if (!res.ok) {
        toast.error(tErrors(res.error.code));
        return;
      }
      setOn(res.data.enabled);
      toast.success(res.data.enabled ? t("turnedOn") : t("turnedOff"));
    });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-ink">{on ? t("on") : t("off")}</p>
        <p className="text-[13px] text-muted">{!on && blocker ? t(`blockers.${blocker}`) : t("hint")}</p>
      </div>
      <Button
        type="button"
        variant={on ? "outline" : "accent"}
        role="switch"
        aria-checked={on}
        aria-label={t("label")}
        disabled={pending || (!on && blocker !== null)}
        onClick={toggle}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {on ? t("turnOff") : t("turnOn")}
      </Button>
    </div>
  );
}
