"use server";

import { requireContext } from "../auth/context";
import { enqueue } from "../jobs/runner";
import { run, type ActionResult } from "./result";

/** Runs the Attention Required health check now (spec §10). Operator only. */
export async function runHealthCheckNowAction(): Promise<ActionResult<null>> {
  return run(async () => {
    await requireContext({ permission: "admin.access" });
    await enqueue({ name: "health/check.requested", data: {} });
    return null;
  });
}
