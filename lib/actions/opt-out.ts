"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServiceClient } from "../db/supabase/service-client";
import { env } from "../env";
import { optOutByToken } from "../jobs/opt-out-core";
import { allowRate, requestIp } from "../rate-limit";

/**
 * The opt-out button (spec §16): a POST, so link previews and scanners that
 * fetch the URL never unsubscribe anyone. Public: the 8-character random
 * token is the only key, and it identifies one message, not a person.
 */
export async function optOutAction(form: FormData): Promise<void> {
  const token = z
    .string()
    .regex(/^[A-Za-z0-9]{8}$/)
    .safeParse(form.get("token"));
  if (!token.success || env.DATA_SOURCE !== "supabase") redirect("/");
  if (!(await allowRate("optOut", { ip: await requestIp() }))) redirect(`/o/${token.data}?pozdeji=1`);
  await optOutByToken(createServiceClient(), {
    token: token.data,
    pepper: env.SUPPRESSION_PEPPER ?? "",
    now: new Date(),
  });
  redirect(`/o/${token.data}?hotovo=1`);
}
