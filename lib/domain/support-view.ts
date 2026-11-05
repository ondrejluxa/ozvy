/** Why the operator opens a shop's client UI (spec §10: reason required, logged). */
export const SUPPORT_REASONS = ["client_request", "troubleshooting", "onboarding", "results_review", "other"] as const;
export type SupportReason = (typeof SUPPORT_REASONS)[number];
