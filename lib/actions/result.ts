import { z } from "zod";
import { DomainError } from "../db/mutations";

/**
 * Server actions return a discriminated result instead of throwing to the
 * client (spec §24). `code` maps to an i18n key under errors.*.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: { code: string } };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(code: string): ActionResult<never> {
  return { ok: false, error: { code } };
}

export async function run<T>(fn: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof DomainError) return fail(err.code);
    if (err instanceof z.ZodError) return fail("validation");
    console.error("[action] unexpected error", err instanceof Error ? err.message : err);
    return fail("internal");
  }
}
