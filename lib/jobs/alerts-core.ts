import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../db/types.gen";
import { evaluateAlerts, type Alert } from "../domain/alerts/rules";
import { digestHtml, digestSubject, digestText, type DigestInput } from "../domain/alerts/digest";
import { formatTime, pragueParts, pragueTime } from "../domain/dates";

/**
 * Health check (spec §10): evaluates the first six Attention Required rules
 * for every open company and keeps public.alerts in step. One open row per
 * dedupe key: a new issue opens an alert, a gone issue resolves it, an
 * unchanged issue is left alone. Runs every 15 minutes and before the digest.
 */

type Db = SupabaseClient<Database>;

type CampaignJson = {
  id: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  started_at: string | null;
  sent: number;
  failed: number;
  completed: number;
};
type ImportJson = { id: string; status: string; updated_at: string; rows: number; invalid: number };
type DsrJson = { id: string; type: string; created_at: string; due_at: string };

/** Below 50 finished messages the delivery rate is noise. */
const MIN_FINISHED = 50;

export async function evaluateAll(db: Db, now: Date): Promise<Alert[]> {
  const { data, error } = await db.rpc("alert_inputs");
  if (error) throw new Error(`alert inputs failed: ${error.code}`);
  return (data ?? []).flatMap((row) => {
    const finished = row.delivered_recent + row.undelivered_recent;
    return evaluateAlerts({
      companyId: row.company_id,
      companyStatus: row.company_status,
      companyCreatedAt: new Date(row.company_created_at),
      campaigns: ((row.campaigns ?? []) as CampaignJson[]).map((c) => ({
        id: c.id,
        status: c.status,
        // "Awaiting approval > 48 h" counts from the submission.
        createdAt: new Date(c.submitted_at ?? c.created_at),
        sentAt: c.started_at ? new Date(c.started_at) : null,
        sentCount: c.sent,
        failedCount: c.failed,
        completedConversions: c.completed,
      })),
      lastSendAt: row.last_send_at ? new Date(row.last_send_at) : null,
      recentDeliveryRate: finished >= MIN_FINISHED ? row.delivered_recent / finished : null,
      // ROI and opportunity rules come after the first six (spec §40.15).
      roiPreviousMonths: [null, null],
      topOpportunity: null,
      imports: ((row.imports ?? []) as ImportJson[]).map((i) => ({
        id: i.id,
        status: i.status,
        updatedAt: new Date(i.updated_at),
        rows: i.rows,
        invalid: i.invalid,
      })),
      dataSubjectRequests: ((row.dsrs ?? []) as DsrJson[]).map((r) => ({
        id: r.id,
        type: r.type,
        createdAt: new Date(r.created_at),
        dueAt: r.due_at,
      })),
      now,
    });
  });
}

export interface HealthCheckResult {
  open: number;
  opened: number;
  resolved: number;
}

export async function runHealthCheck(db: Db, now: Date): Promise<HealthCheckResult> {
  const current = await evaluateAll(db, now);
  const { data: open, error } = await db.from("alerts").select("id, dedupe_key").neq("status", "resolved");
  if (error) throw new Error(`alerts read failed: ${error.code}`);
  const openKeys = new Set((open ?? []).map((a) => a.dedupe_key));
  const currentKeys = new Set(current.map((a) => a.key));

  const fresh = current.filter((a) => !openKeys.has(a.key));
  if (fresh.length) {
    // Open keys were filtered above and the check runs one at a time (Inngest concurrency 1);
    // the partial unique index still refuses a duplicate open alert.
    const { error: e } = await db.from("alerts").insert(
      fresh.map((a) => ({
        company_id: a.companyId,
        type: a.type,
        severity: a.severity,
        dedupe_key: a.key,
        title: a.type,
        // created_at = when the alert opened (digest); since = when the issue began (age in the UI).
        detail: {
          params: a.params,
          campaignId: a.campaignId ?? null,
          presetKey: a.presetKey ?? null,
          since: a.createdAt.toISOString(),
        } as NonNullable<Json>,
      })),
    );
    if (e) throw new Error(`alerts insert failed: ${e.code}`);
  }
  // The gateway breaker alert is opened by the dispatcher and stays open until
  // the breaker closes (a successful probe or the operator's reset).
  const { data: platform } = await db.from("platform_settings").select("provider_paused_until").maybeSingle();
  const breakerOpen = Boolean(platform?.provider_paused_until);
  const gone = (open ?? [])
    .filter((a) => !currentKeys.has(a.dedupe_key))
    .filter((a) => !(breakerOpen && a.dedupe_key.startsWith("provider_paused:")))
    .map((a) => a.id);
  if (gone.length) {
    await db.from("alerts").update({ status: "resolved", resolved_at: now.toISOString() }).in("id", gone);
  }
  await db.from("platform_settings").update({ last_health_check_at: now.toISOString() }).eq("id", true);
  return { open: current.length, opened: fresh.length, resolved: gone.length };
}

// ---------- daily digest ----------

export async function buildDigest(
  db: Db,
  now: Date,
  opts: { titles: Record<string, string>; appUrl: string },
): Promise<{ subject: string; text: string; html: string; input: DigestInput }> {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const p = pragueParts(now);
  const dayStart = pragueTime(p.year, p.month, p.day, 0, 0).toISOString();
  const dayEnd = pragueTime(p.year, p.month, p.day, 23, 59).toISOString();
  const [companies, openAlerts, opened, resolved, sent, failed, today] = await Promise.all([
    db.from("companies").select("id, name"),
    db.from("alerts").select("id", { count: "exact", head: true }).neq("status", "resolved"),
    db.from("alerts").select("company_id, type").gte("created_at", since).order("created_at"),
    db.from("alerts").select("id", { count: "exact", head: true }).gte("resolved_at", since),
    db.from("messages").select("id", { count: "exact", head: true }).gte("sent_at", since),
    db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "undelivered"])
      .gte("updated_at", since),
    db
      .from("campaigns")
      .select("company_id, name, scheduled_at")
      .eq("status", "scheduled")
      .gte("scheduled_at", dayStart)
      .lte("scheduled_at", dayEnd)
      .order("scheduled_at"),
  ]);
  const name = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const input: DigestInput = {
    openAlerts: openAlerts.count ?? 0,
    opened24h: (opened.data ?? []).map((a) => ({ company: name.get(a.company_id ?? "") ?? "—", type: a.type })),
    resolved24h: resolved.count ?? 0,
    sent24h: sent.count ?? 0,
    failed24h: failed.count ?? 0,
    campaignsToday: (today.data ?? []).map((c) => ({
      company: name.get(c.company_id) ?? "—",
      name: c.name,
      at: formatTime(c.scheduled_at!),
    })),
    titles: opts.titles,
    appUrl: opts.appUrl,
  };
  return { subject: digestSubject(input), text: digestText(input), html: digestHtml(input), input };
}

/** E-mail addresses of all platform admins (auth e-mails need the service role). */
export async function adminEmails(db: Db): Promise<string[]> {
  const { data } = await db.from("platform_admins").select("user_id");
  const emails: string[] = [];
  for (const a of data ?? []) {
    const { data: user } = await db.auth.admin.getUserById(a.user_id);
    if (user.user?.email) emails.push(user.user.email);
  }
  return emails;
}
