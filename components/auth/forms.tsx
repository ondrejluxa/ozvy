"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/inputs";
import {
  requestPasswordResetAction,
  signInAction,
  startTotpEnrollmentAction,
  updatePasswordAction,
  verifyTotpAction,
  type FormState,
  type TotpEnrollment,
} from "@/lib/actions/auth";
import { acceptInvitationAction, acceptInvitationAsCurrentUserAction } from "@/lib/actions/invitations";

function FormError({ state }: { state: FormState }) {
  const t = useTranslations("auth.errors");
  const messages = [...(state.error ? [state.error] : []), ...(state.issues ?? [])];
  if (!messages.length) return null;
  return (
    <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
      {messages.map((m) => (
        <p key={m}>{t(m)}</p>
      ))}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  ...props
}: { id: string; label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function Submit({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <Button type="submit" variant="accent" className="w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth.login");
  const [state, action, pending] = useActionState(signInAction, {});
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">{t("title")}</h1>
      <FormError state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field
        id="email"
        label={t("email")}
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
      />
      <Field id="password" label={t("password")} type="password" autoComplete="current-password" required />
      <Submit pending={pending} label={t("submit")} pendingLabel={t("submitting")} />
      <div className="flex flex-col gap-2 text-[13px]">
        <Link href="/reset-password" className="text-accent hover:underline">
          {t("forgot")}
        </Link>
        <p className="text-muted">{t("inviteOnly")}</p>
      </div>
    </form>
  );
}

export function ResetRequestForm() {
  const t = useTranslations("auth.reset");
  const tLogin = useTranslations("auth.login");
  const [state, action, pending] = useActionState(requestPasswordResetAction, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">{t("title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("description")}</p>
      </div>
      {state.done ? (
        <p role="status" className="rounded-md bg-accent-soft px-3 py-2 text-[13px] text-accent-strong">
          {t("sent")}
        </p>
      ) : (
        <>
          <Field id="email" label={tLogin("email")} type="email" autoComplete="email" required />
          <Submit pending={pending} label={t("submit")} pendingLabel={t("submitting")} />
        </>
      )}
      <Link href="/login" className="block text-[13px] text-accent hover:underline">
        {t("back")}
      </Link>
    </form>
  );
}

export function UpdatePasswordForm() {
  const t = useTranslations("auth.update");
  const [state, action, pending] = useActionState(updatePasswordAction, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">{t("title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("description")}</p>
      </div>
      <FormError state={state} />
      <Field id="password" label={t("password")} type="password" autoComplete="new-password" required />
      <Field id="confirm" label={t("confirm")} type="password" autoComplete="new-password" required />
      <Submit pending={pending} label={t("submit")} pendingLabel={t("submitting")} />
    </form>
  );
}

function TotpCodeForm({ factorId, enrolling, next }: { factorId: string; enrolling: boolean; next?: string }) {
  const t = useTranslations("auth.mfa");
  const [state, action, pending] = useActionState(verifyTotpAction, {});
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="enrolling" value={enrolling ? "1" : "0"} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field
        id="code"
        label={t("code")}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        className="tnum h-11 text-center text-lg tracking-[0.4em]"
      />
      <Submit pending={pending} label={t("submit")} pendingLabel={t("submitting")} />
    </form>
  );
}

export function MfaVerify({ factorId, next }: { factorId: string; next?: string }) {
  const t = useTranslations("auth.mfa");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">{t("title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("verifyDescription")}</p>
      </div>
      <TotpCodeForm factorId={factorId} enrolling={false} next={next} />
    </div>
  );
}

export function MfaEnroll({ next }: { next?: string }) {
  const t = useTranslations("auth.mfa");
  const tErrors = useTranslations("auth.errors");
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = () =>
    startTransition(async () => {
      const result = await startTotpEnrollmentAction();
      if ("error" in result) setError(result.error);
      else setEnrollment(result);
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">{t("enrollTitle")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("enrollDescription")}</p>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {tErrors(error)}
        </p>
      )}
      {!enrollment ? (
        <Button variant="accent" className="w-full" onClick={start} disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? t("starting") : t("start")}
        </Button>
      ) : (
        <>
          {/* Data URI SVG returned by Supabase Auth; rendered as an image, never as markup. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qrCode}
            alt=""
            width={180}
            height={180}
            className="mx-auto rounded-md border border-line"
          />
          <div className="text-center">
            <div className="text-[12px] text-muted">{t("secret")}</div>
            <code data-testid="totp-secret" className="break-all text-[13px] text-ink">
              {enrollment.secret}
            </code>
          </div>
          <TotpCodeForm factorId={enrollment.factorId} enrolling next={next} />
        </>
      )}
    </div>
  );
}

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("auth.invite");
  const [state, action, pending] = useActionState(acceptInvitationAction, {});
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <input type="hidden" name="token" value={token} />
      <Field id="email" label={t("email")} value={email} readOnly disabled />
      <Field
        id="fullName"
        label={t("fullName")}
        autoComplete="name"
        required
        maxLength={120}
        defaultValue={state.values?.fullName}
      />
      <Field
        id="password"
        label={t("password")}
        type="password"
        autoComplete="new-password"
        hint={t("passwordHint")}
        required
      />
      <Field id="confirm" label={t("confirm")} type="password" autoComplete="new-password" required />
      <Submit pending={pending} label={t("submit")} pendingLabel={t("submitting")} />
    </form>
  );
}

export function AcceptAsCurrentUser({ token }: { token: string }) {
  const t = useTranslations("auth.invite");
  const [state, action, pending] = useActionState(acceptInvitationAsCurrentUserAction, {});
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <input type="hidden" name="token" value={token} />
      <Submit pending={pending} label={t("acceptAsCurrent")} pendingLabel={t("submitting")} />
    </form>
  );
}
