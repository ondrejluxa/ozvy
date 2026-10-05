import "server-only";
import { parseEnv } from "./env/schema";

/**
 * Validated server environment. Parsed once at module load: an invalid
 * configuration (for example a real SMS provider outside production without
 * a whitelist) stops the server from starting. Never import from client code;
 * secrets live here.
 */
export const env = parseEnv(process.env);

/** Drives every "demo data" label in the UI. */
export const isDemo = env.DEMO_MODE;
