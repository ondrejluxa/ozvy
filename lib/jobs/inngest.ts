import "server-only";
import { Inngest } from "inngest";
import { runCommitImport, runParseImport, runValidateImport } from "./imports";
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

export const functions = [importParse, importValidate, importCommit];
