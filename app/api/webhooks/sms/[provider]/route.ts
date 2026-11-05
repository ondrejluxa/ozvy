import { createServiceClient } from "@/lib/db/supabase/service-client";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs/runner";
import { storeEvents } from "@/lib/jobs/opt-out-core";
import { getSmsProvider } from "@/lib/providers/sms";

/**
 * SMS gateway callbacks (spec §16 step 5, §17): delivery reports and inbound
 * replies. The request is verified (shared secret in the URL for BulkGate,
 * which signs nothing), stored raw and deduplicated, answered with 200 at
 * once and processed in the background. BulkGate calls with GET (one report)
 * or POST (bulk JSON).
 */
export const dynamic = "force-dynamic";

async function handle(req: Request, ctx: RouteContext<"/api/webhooks/sms/[provider]">) {
  const { provider: name } = await ctx.params;
  if (env.DATA_SOURCE !== "supabase") return new Response("Not found", { status: 404 });
  const provider = getSmsProvider();
  if (name !== provider.id || !provider.verifyWebhook || !provider.parseWebhook) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await provider.verifyWebhook(req))) return new Response("Unauthorized", { status: 401 });
  let events;
  try {
    events = await provider.parseWebhook(req);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  await storeEvents(createServiceClient(), provider.id, events);
  await enqueue({ name: "messaging/events.requested", data: {} });
  return new Response("OK", { status: 200 });
}

export const GET = handle;
export const POST = handle;
