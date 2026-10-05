/**
 * Password policy (spec §20): at least 12 characters with letters and digits
 * (matches supabase/config.toml). Leaked-password checks are a hosted
 * Supabase Auth setting and run server-side there.
 */

export const MIN_PASSWORD_LENGTH = 12;

export type PasswordIssue = "too_short" | "needs_letters_and_digits" | "mismatch";

export function passwordIssues(password: string, confirmation?: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) issues.push("too_short");
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) issues.push("needs_letters_and_digits");
  if (confirmation !== undefined && confirmation !== password) issues.push("mismatch");
  return issues;
}
