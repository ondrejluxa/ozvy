import { getRequestConfig } from "next-intl/server";
import messages from "@/messages/cs.json";

// Phase 0 ships Czech only. Locale routing is not needed; the structure is
// ready for an `en.json` later without touching components.
export default getRequestConfig(async () => ({
  locale: "cs",
  timeZone: "Europe/Prague",
  messages,
}));
