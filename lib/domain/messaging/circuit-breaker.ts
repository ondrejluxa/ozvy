/**
 * SMS gateway circuit breaker (spec §24): when more than 20 % of send
 * attempts in the last 5 minutes fail with gateway errors, sending pauses for
 * 15 minutes and the operator gets a critical alert. After the pause one
 * probe message is sent: success closes the breaker, failure pauses again.
 *
 * Gateway errors are retryable rejections (5xx, 429) and calls whose outcome
 * is unknown (timeouts, network errors). A rejected number is the
 * recipient's problem, not the gateway's, and does not count.
 */

export const BREAKER = {
  windowMinutes: 5,
  /** Too few attempts say nothing about the gateway. */
  minAttempts: 20,
  maxFailureRate: 0.2,
  pauseMinutes: 15,
} as const;

export type BreakerState = "closed" | "open" | "probe";

/** closed = send normally; open = paused, send nothing; probe = pause over, try one message. */
export function breakerState(pausedUntil: Date | null, now: Date): BreakerState {
  if (!pausedUntil) return "closed";
  return now.getTime() < pausedUntil.getTime() ? "open" : "probe";
}

export function shouldTrip(window: { attempts: number; failures: number }): boolean {
  return window.attempts >= BREAKER.minAttempts && window.failures / window.attempts > BREAKER.maxFailureRate;
}

export function pausedUntil(now: Date): Date {
  return new Date(now.getTime() + BREAKER.pauseMinutes * 60_000);
}

export type SendOutcome = { ok: true } | { ok: false; retryable: boolean } | { exception: true };

/** Whether one send attempt counts against the gateway. */
export function isGatewayFailure(outcome: SendOutcome): boolean {
  if ("exception" in outcome) return true;
  return !outcome.ok && outcome.retryable;
}
