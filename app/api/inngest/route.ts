import { serve } from "inngest/next";
import { functions, inngest } from "@/lib/jobs/inngest";

/** Inngest endpoint (signed requests only; INNGEST_SIGNING_KEY in production). */
export const { GET, POST, PUT } = serve({ client: inngest, functions });
