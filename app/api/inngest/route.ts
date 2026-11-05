import { serve } from "inngest/next";
import { functions, inngest } from "@/lib/jobs/inngest";

/**
 * Inngest endpoint (signed requests only; INNGEST_SIGNING_KEY in production).
 * Jobs run inside this function: an explicit limit (Vercel Pro allows up to
 * 800 s) instead of the platform default. The messaging tick stops sending
 * after 40 s and claims 10 messages at a time, so it ends well inside it.
 */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
