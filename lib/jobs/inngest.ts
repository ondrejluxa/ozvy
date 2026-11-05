import "server-only";
import { Inngest } from "inngest";
import { runCommitImport, runParseImport, runValidateImport } from "./imports";
import { runLifecycleRecompute, runNightlyLifecycle, runNightlyStatsJob } from "./lifecycle";
import type { JobEvent } from "./runner";
import { runDailyDigestJob, runHealthCheckJob } from "./health";
import { runMessaging, runProviderEvents } from "./messaging";
import { runVocativeRefresh } from "./vocatives";

/**
 * Inngest client and functions (spec §26 "Inngest for all background jobs").
 * Each function is a thin wrapper around a plain job function, so the same
 * code also runs inline locally (JOB_RUNNER=inline). Retries follow spec §24.
 */
export const inngest = new Inngest({ id: "navrat" });

type Data<N extends JobEvent["name"]> = Extract<JobEvent, { name: N }>["data"];

export const importParse = inngest.createFunction(
  { id: "import-parse", retries: 3, triggers: [{ event: "import/parse.requested" }] },
  async ({ event, step }) => step.run("parse", () => runParseImport(event.data as Data<"import/parse.requested">)),
);

export const importValidate = inngest.createFunction(
  { id: "import-validate", retries: 3, triggers: [{ event: "import/validate.requested" }] },
  async ({ event, step }) =>
    step.run("validate", () => runValidateImport(event.data as Data<"import/validate.requested">)),
);

export const importCommit = inngest.createFunction(
  // One commit per import at a time; batches are resumable, so retries are safe.
  {
    id: "import-commit",
    retries: 3,
    concurrency: { key: "event.data.importId", limit: 1 },
    triggers: [{ event: "import/commit.requested" }],
  },
  async ({ event, step }) => step.run("commit", () => runCommitImport(event.data as Data<"import/commit.requested">)),
);

/** Nightly lifecycle recompute for every open company (spec §12), 03:00 Prague time. */
export const lifecycleNightly = inngest.createFunction(
  { id: "lifecycle-nightly", retries: 1, triggers: [{ cron: "TZ=Europe/Prague 0 3 * * *" }] },
  async ({ step }) => step.run("recompute-all", () => runNightlyLifecycle()),
);

/** Attribution windows and company_monthly_stats, 03:30 Prague time, after the lifecycle recompute. */
export const statsNightly = inngest.createFunction(
  { id: "stats-nightly", retries: 2, triggers: [{ cron: "TZ=Europe/Prague 30 3 * * *" }] },
  async ({ step }) => step.run("windows-and-stats", () => runNightlyStatsJob()),
);

/** One company, after its thresholds changed or on the operator's request. */
export const lifecycleRecompute = inngest.createFunction(
  {
    id: "lifecycle-recompute",
    retries: 3,
    concurrency: { key: "event.data.companyId", limit: 1 },
    triggers: [{ event: "lifecycle/recompute.requested" }],
  },
  async ({ event, step }) =>
    step.run("recompute", () => runLifecycleRecompute(event.data as Data<"lifecycle/recompute.requested">)),
);

/** Vocative suggestions for new surnames (spec §15): rules, then one AI batch per 100. */
export const vocativesRefresh = inngest.createFunction(
  {
    id: "vocatives-refresh",
    retries: 2,
    concurrency: { key: "event.data.companyId", limit: 1 },
    triggers: [{ event: "vocatives/refresh.requested" }],
  },
  async ({ event, step }) =>
    step.run("refresh", () => runVocativeRefresh(event.data as Data<"vocatives/refresh.requested">)),
);

/**
 * Messaging tick every minute (spec §16): start due campaigns, queue
 * follow-ups, dispatch at the provider rate, advance statuses. One at a time.
 */
export const messagingTick = inngest.createFunction(
  {
    id: "messaging-tick",
    retries: 0,
    concurrency: { limit: 1 },
    triggers: [{ cron: "* * * * *" }, { event: "messaging/tick.requested" }],
  },
  async ({ step }) => step.run("tick", () => runMessaging()),
);

/** Gateway callbacks stored by the webhook route, applied off the request path. */
export const messagingEvents = inngest.createFunction(
  {
    id: "messaging-events",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: [{ event: "messaging/events.requested" }],
  },
  async ({ step }) => step.run("process", () => runProviderEvents()),
);

/** Attention Required: every 15 minutes, or on the operator's request (spec §10). */
export const healthCheck = inngest.createFunction(
  {
    id: "health-check",
    retries: 1,
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/15 * * * *" }, { event: "health/check.requested" }],
  },
  async ({ step }) => step.run("evaluate", () => runHealthCheckJob()),
);

/** Operator digest, 06:00 Prague (spec §25). */
export const dailyDigest = inngest.createFunction(
  { id: "daily-digest", retries: 2, triggers: [{ cron: "TZ=Europe/Prague 0 6 * * *" }] },
  async ({ step }) => step.run("digest", () => runDailyDigestJob()),
);

export const functions = [
  importParse,
  importValidate,
  importCommit,
  lifecycleNightly,
  lifecycleRecompute,
  statsNightly,
  vocativesRefresh,
  messagingTick,
  messagingEvents,
  healthCheck,
  dailyDigest,
];
