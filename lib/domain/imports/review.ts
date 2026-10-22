import { INVALID_ISSUES, type RowStatus } from "./validate";

/** Status of a row from its issues, used when the operator re-includes an excluded row. */
export function statusFromIssues(issues: string[]): Exclude<RowStatus, "excluded"> {
  if (issues.some((i) => (INVALID_ISSUES as readonly string[]).includes(i))) return "invalid";
  if (issues.includes("duplicate_in_file")) return "duplicate";
  return issues.length ? "warning" : "valid";
}

/** Import states in which a background job is working and the page should refresh itself. */
export const WORKING_STATES = ["uploaded", "parsing", "validating", "committing"] as const;
