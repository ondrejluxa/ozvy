import { describe, expect, it } from "vitest";
import { homePath, resolveAccess, safeNextPath, type SessionInfo } from "@/lib/auth/access";
import { PERMISSIONS, can, type CompanySubject, type Permission } from "@/lib/auth/permissions";
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  invitationState,
  isWellFormedToken,
  normalizeEmail,
} from "@/lib/domain/invitations";
import { passwordIssues } from "@/lib/domain/passwords";

const owner = (mode: "managed" | "self_service", approval = false): CompanySubject => ({
  isPlatformAdmin: false,
  role: "shop_owner",
  serviceMode: mode,
  requiresClientApproval: approval,
});
const manager: CompanySubject = { ...owner("managed"), role: "shop_manager" };
const admin: CompanySubject = { ...owner("managed"), isPlatformAdmin: true, role: null };

// Spec §20 table: super_admin, owner (managed), owner (self-service), manager.
const EXPECTED: Record<Permission, [boolean, boolean, boolean, boolean]> = {
  "dashboard.view": [true, true, true, true],
  "customers.view": [true, true, true, true],
  "customers.edit_contact": [true, true, true, true],
  "customers.export": [true, true, true, false],
  "customers.delete": [true, false, true, false],
  "conversions.mark": [true, true, true, true],
  "imports.run": [true, false, true, false],
  "segments.manage": [true, false, true, false],
  "campaigns.create": [true, false, true, false],
  "campaigns.approve": [true, false, true, false],
  "campaigns.pause": [true, true, true, false],
  "settings.company": [true, true, true, false],
  "users.invite": [true, true, true, false],
  "billing.view": [true, true, true, false],
  "admin.access": [true, false, false, false],
};

describe("permission matrix (spec §20)", () => {
  it.each(PERMISSIONS)("%s", (permission) => {
    const [a, managed, selfService, mgr] = EXPECTED[permission];
    expect(can(admin, permission)).toBe(a);
    expect(can(owner("managed"), permission)).toBe(managed);
    expect(can(owner("self_service"), permission)).toBe(selfService);
    expect(can(manager, permission)).toBe(mgr);
  });

  it("lets a managed owner approve only when the shop requires client approval", () => {
    expect(can(owner("managed", true), "campaigns.approve")).toBe(true);
    expect(can(owner("managed", false), "campaigns.approve")).toBe(false);
  });

  it("denies everything without a role", () => {
    expect(PERMISSIONS.some((p) => can({ ...owner("managed"), role: null }, p))).toBe(false);
  });
});

const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const session = (o: Partial<SessionInfo> = {}): SessionInfo => ({
  userId: "u1",
  email: "jana@example.cz",
  fullName: "Jana",
  isPlatformAdmin: false,
  aal: "aal1",
  hasVerifiedTotp: false,
  memberships: [
    { companyId: A, companyName: "A", role: "shop_manager", serviceMode: "managed", requiresClientApproval: false },
  ],
  ...o,
});

describe("resolveAccess", () => {
  it("requires a session", () => {
    expect(resolveAccess(null, { permission: "dashboard.view", companyId: A })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("allows members inside their own company only", () => {
    expect(resolveAccess(session(), { permission: "customers.view", companyId: A }).ok).toBe(true);
    expect(resolveAccess(session(), { permission: "customers.view", companyId: B })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(resolveAccess(session(), { permission: "customers.view" })).toEqual({ ok: false, reason: "forbidden" });
  });

  it("applies the role's permissions", () => {
    expect(resolveAccess(session(), { permission: "users.invite", companyId: A }).ok).toBe(false);
    expect(resolveAccess(session(), { permission: "admin.access" })).toEqual({ ok: false, reason: "forbidden" });
  });

  it("forces platform admins through TOTP MFA", () => {
    const adminSession = session({ isPlatformAdmin: true, memberships: [] });
    expect(resolveAccess(adminSession, { permission: "admin.access" })).toEqual({
      ok: false,
      reason: "mfa_enrollment_required",
    });
    expect(resolveAccess({ ...adminSession, hasVerifiedTotp: true }, { permission: "admin.access" })).toEqual({
      ok: false,
      reason: "mfa_required",
    });
    const verified = { ...adminSession, hasVerifiedTotp: true, aal: "aal2" as const };
    expect(resolveAccess(verified, { permission: "admin.access" }).ok).toBe(true);
    expect(resolveAccess(verified, { permission: "customers.delete", companyId: B }).ok).toBe(true);
  });
});

describe("redirect helpers", () => {
  it("sends users to the right home", () => {
    expect(homePath(session())).toBe("/app");
    expect(homePath(session({ memberships: [] }))).toBe("/forbidden");
    expect(homePath(session({ isPlatformAdmin: true }))).toBe("/mfa");
    expect(homePath(session({ isPlatformAdmin: true, aal: "aal2" }))).toBe("/admin");
  });

  it("accepts only same-origin relative next paths", () => {
    expect(safeNextPath("/admin/companies", "/app")).toBe("/admin/companies");
    expect(safeNextPath("https://evil.example", "/app")).toBe("/app");
    expect(safeNextPath("//evil.example", "/app")).toBe("/app");
    expect(safeNextPath("/\\evil.example", "/app")).toBe("/app");
    expect(safeNextPath(null, "/app")).toBe("/app");
  });
});

describe("invitation tokens", () => {
  it("are random, URL-safe and only stored as a SHA-256 hash", async () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).not.toBe(b);
    expect(isWellFormedToken(a)).toBe(true);
    expect(isWellFormedToken("short")).toBe(false);
    expect(isWellFormedToken(null)).toBe(false);
    const hash = await hashInvitationToken(a);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashInvitationToken(a)).toBe(hash);
    expect(hash).not.toContain(a);
  });

  it("expire after 7 days and work once", () => {
    const now = new Date("2026-10-05T10:00:00Z");
    const expires = invitationExpiry(now).toISOString();
    expect(expires).toBe("2026-10-12T10:00:00.000Z");
    expect(invitationState({ expires_at: expires, accepted_at: null }, now)).toBe("valid");
    expect(invitationState({ expires_at: expires, accepted_at: null }, new Date("2026-10-12T10:00:01Z"))).toBe(
      "expired",
    );
    expect(invitationState({ expires_at: expires, accepted_at: "2026-10-06T08:00:00Z" }, now)).toBe("accepted");
    expect(normalizeEmail("  Jana.Novakova@Example.CZ ")).toBe("jana.novakova@example.cz");
  });
});

describe("password policy", () => {
  it("requires 12+ characters with letters and digits", () => {
    expect(passwordIssues("short1")).toContain("too_short");
    expect(passwordIssues("onlyletterslong")).toContain("needs_letters_and_digits");
    expect(passwordIssues("123456789012345")).toContain("needs_letters_and_digits");
    expect(passwordIssues("dlouheheslo2026")).toEqual([]);
    expect(passwordIssues("dlouheheslo2026", "jine")).toEqual(["mismatch"]);
  });
});
