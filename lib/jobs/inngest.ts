import "server-only";
import { Inngest } from "inngest";
import { runCommitImport, runParseImport, runValidateImport } from "./imports";
import { runLifecycleRecompute, runNightlyLifecycle } from "./lifecycle";
import type { JobEvent } from "./runner";

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

export const functions = [importParse, importValidate, importCommit, lifecycleNightly, lifecycleRecompute];
