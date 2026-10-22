import "server-only";
import { after } from "next/server";
import { env } from "../env";
import type { TextEncodingName } from "../domain/imports/detect";

/**
 * Starts a background job. Production sends an Inngest event; local
 * development and CI (JOB_RUNNER=inline) run the same job function right
 * after the response, so no Inngest dev server is needed. Payloads carry
 * IDs only (spec §22).
 */
export type JobEvent =
  | {
      name: "import/parse.requested";
      data: { companyId: string; importId: string; encoding?: TextEncodingName; sheet?: string };
    }
  | { name: "import/validate.requested"; data: { companyId: string; importId: string } }
  | { name: "import/commit.requested"; data: { companyId: string; importId: string } };

export async function enqueue(event: JobEvent): Promise<void> {
  if (env.JOB_RUNNER === "inngest") {
    const { inngest } = await import("./inngest");
    await inngest.send(event);
    return;
  }
  const jobs = await import("./imports");
  after(async () => {
    try {
      if (event.name === "import/parse.requested") await jobs.runParseImport(event.data);
      else if (event.name === "import/validate.requested") await jobs.runValidateImport(event.data);
      else await jobs.runCommitImport(event.data);
    } catch (err) {
      console.error("[jobs] inline job failed", event.name, err instanceof Error ? err.message : "");
    }
  });
}
