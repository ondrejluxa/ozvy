import "server-only";
import messages from "../../messages/cs.json";
import { createServiceClient } from "../db/supabase/service-client";
import { env } from "../env";
import { getEmailProvider } from "../providers/email";
import { adminEmails, buildDigest, runHealthCheck, type HealthCheckResult } from "./alerts-core";

/** Health check and daily digest with the service role (spec §10, §25). */

export async function runHealthCheckJob(): Promise<HealthCheckResult> {
  return runHealthCheck(createServiceClient(), new Date());
}

/** Plain titles per alert type for the digest e-mail (the UI titles carry parameters). */
const DIGEST_TITLES: Record<string, string> = Object.fromEntries(
  Object.entries(messages.alerts as Record<string, unknown>)
    .filter(([, v]) => typeof v === "object" && v !== null && "digest" in v)
    .map(([k, v]) => [k, (v as { digest: string }).digest]),
);

export async function runDailyDigestJob(): Promise<{ sent: number; subject: string }> {
  const db = createServiceClient();
  const now = new Date();
  await runHealthCheck(db, now);
  const digest = await buildDigest(db, now, { titles: DIGEST_TITLES, appUrl: env.NEXT_PUBLIC_APP_URL ?? "" });
  const to = await adminEmails(db);
  const email = getEmailProvider();
  for (const address of to) {
    await email.send({ to: address, subject: digest.subject, text: digest.text, html: digest.html });
  }
  return { sent: to.length, subject: digest.subject };
}
