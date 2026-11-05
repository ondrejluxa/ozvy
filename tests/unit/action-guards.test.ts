import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every exported server action authorises before it touches data (spec §42
 * rule 3): it calls requireContext, or is a guarded demo action, or is one
 * of the intentionally public actions below (each protected otherwise).
 */
const PUBLIC: Record<string, string> = {
  "auth.ts:signInAction": "sign-in; rate-limited per e-mail and IP",
  "auth.ts:signOutAction": "ends the caller's own session",
  "auth.ts:requestPasswordResetAction": "same answer for every address; rate-limited",
  "auth.ts:updatePasswordAction": "needs the caller's own (recovery) session",
  "auth.ts:verifyTotpAction": "MFA step of the caller's own session",
  "auth.ts:startTotpEnrollmentAction": "MFA enrolment of the caller's own session",
  "invitations.ts:acceptInvitationAction": "single-use 256-bit invitation token; rate-limited",
  "invitations.ts:acceptInvitationAsCurrentUserAction": "token + the signed-in invited address; rate-limited",
  "opt-out.ts:optOutAction": "8-character message token; POST only; rate-limited",
  "demo.ts:openClientViewAction": "demo only (demoOnly guard)",
  "demo.ts:exitClientViewAction": "demo only (demoOnly guard)",
  "demo.ts:resetDemoAction": "demo only (demoOnly guard)",
};

/** Actions that delegate to a helper in the same file which calls requireContext first. */
const DELEGATES: Record<string, string> = {
  "real-campaigns.ts:approveCampaignAction": "decide(",
  "real-campaigns.ts:rejectCampaignAction": "decide(",
};

const dir = join(process.cwd(), "lib", "actions");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
const sources = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
const actions = files.flatMap((file) => {
  const source = sources[file];
  if (!source.startsWith('"use server"')) return [];
  return source
    .split(/\nexport async function /)
    .slice(1)
    .map((part) => ({ file, name: part.slice(0, part.indexOf("(")), body: part }));
});

describe("server action guards", () => {
  it("finds the actions", () => {
    expect(actions.length).toBeGreaterThan(40);
  });

  it.each(actions.map((a) => [`${a.file}:${a.name}`, a] as const))("%s authorises first", (key, a) => {
    if (PUBLIC[key]) {
      if (a.file === "demo.ts") expect(a.body).toContain("demoOnly()");
      return;
    }
    const helper = DELEGATES[key];
    if (helper) {
      expect(a.body).toContain(helper);
      const name = helper.slice(0, -1);
      const helperBody = sources[a.file].split(`async function ${name}(`)[1] ?? "";
      expect(helperBody, `${name} must call requireContext`).toContain("requireContext(");
      return;
    }
    expect(/requireContext\(|demoGuard\(\)/.test(a.body), `${key} must call requireContext`).toBe(true);
  });

  it("demo campaign actions refuse on real data before anything else", () => {
    const demo = actions.filter((a) => a.file === "campaigns.ts");
    expect(demo.length).toBe(6);
    for (const a of demo) {
      expect(
        /\{\n {2}const blocked = await demoGuard\(\);\n {2}if \(blocked\) return blocked;/.test(a.body),
        a.name,
      ).toBe(true);
    }
    expect(sources["campaigns.ts"]).toContain('if (env.DATA_SOURCE !== "demo") return fail("forbidden");');
  });
});
