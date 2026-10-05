"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { homePath, safeNextPath } from "../auth/access";
import { getSessionInfo } from "../auth/session";
import { audit } from "../audit";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { passwordIssues, type PasswordIssue } from "../domain/passwords";
import { env } from "../env";

/**
 * Auth server actions (spec §20). Error messages are generic and never
 * reveal whether an email exists. All flows use the user's cookie session.
 */

export interface FormState {
  error?: string;
  issues?: PasswordIssue[];
  done?: boolean;
  /** Non-secret field values to keep after a failed submit (spec §24: forms keep input). */
  values?: Record<string, string>;
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

// ---------- sign in / out ----------

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1).max(200), next: z.string().optional() })
    .safeParse(Object.fromEntries(form));
  const values = { email: String(form.get("email") ?? "").slice(0, 254) };
  if (!parsed.success) return { error: "invalid_credentials", values };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    await audit({ action: "auth.login_failed", actorType: "user" });
    return { error: "invalid_credentials", values };
  }
  await audit({ action: "auth.login", actorType: "user", actorUserId: data.user.id });

  // Same client instance: it already carries the new session in memory.
  const { data: admin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  const next = safeNextPath(parsed.data.next, "");
  if (admin) redirect(`/mfa${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  redirect(next || "/app");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------- password reset ----------

export async function requestPasswordResetAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(form.get("email"));
  if (email.success) {
    const supabase = await createSupabaseServerClient();
    // The email template appends token_hash & type to this URL (supabase/templates/recovery.html).
    await supabase.auth.resetPasswordForEmail(email.data, {
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/update-password`,
    });
    await audit({ action: "auth.password_reset_requested", actorType: "user" });
  }
  // Same answer whether or not the address exists.
  return { done: true };
}

export async function updatePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  const issues = passwordIssues(password, String(form.get("confirm") ?? ""));
  if (issues.length) return { issues };

  const session = await getSessionInfo();
  if (!session) return { error: "session_expired" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.code === "same_password" ? "same_password" : "generic" };
  await audit({ action: "auth.password_changed", actorType: "user", actorUserId: session.userId });
  redirect(homePath(session));
}

// ---------- TOTP MFA (required for platform admins) ----------

export interface TotpEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export async function startTotpEnrollmentAction(): Promise<TotpEnrollment | { error: string }> {
  const session = await getSessionInfo();
  if (!session) return { error: "session_expired" };
  const supabase = await createSupabaseServerClient();
  // Abandoned enrolments leave unverified factors behind; clear them first.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Návrat" });
  if (error || !data) return { error: "generic" };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyTotpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({
      factorId: z.string().min(1),
      code: z.string().regex(/^\d{6}$/),
      enrolling: z.enum(["0", "1"]).default("0"),
      next: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalid_code" };

  const session = await getSessionInfo();
  if (!session) return { error: "session_expired" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) return { error: "invalid_code" };
  if (parsed.data.enrolling === "1") {
    await audit({ action: "auth.mfa_enrolled", actorType: "admin", actorUserId: session.userId });
  }
  redirect(safeNextPath(parsed.data.next, session.isPlatformAdmin ? "/admin" : "/app"));
}
