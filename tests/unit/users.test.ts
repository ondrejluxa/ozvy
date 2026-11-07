import { describe, expect, it } from "vitest";
import { memberChangeIssue, type MemberLite } from "@/lib/domain/users";

const owner = (id: string): MemberLite => ({ userId: id, role: "shop_owner" });
const manager = (id: string): MemberLite => ({ userId: id, role: "shop_manager" });

describe("shop user management (spec §20)", () => {
  it("keeps at least one owner", () => {
    const members = [owner("o1"), manager("m1")];
    expect(memberChangeIssue(members, { userId: "o1", role: "shop_manager" })).toBe("last_owner");
    expect(memberChangeIssue(members, { userId: "o1", remove: true })).toBe("last_owner");
  });

  it("lets a second owner step down or leave", () => {
    const members = [owner("o1"), owner("o2")];
    expect(memberChangeIssue(members, { userId: "o1", role: "shop_manager" })).toBeNull();
    expect(memberChangeIssue(members, { userId: "o2", remove: true })).toBeNull();
  });

  it("promotes, demotes and removes managers freely", () => {
    const members = [owner("o1"), manager("m1")];
    expect(memberChangeIssue(members, { userId: "m1", role: "shop_owner" })).toBeNull();
    expect(memberChangeIssue(members, { userId: "m1", remove: true })).toBeNull();
  });

  it("reports no-ops and unknown users", () => {
    const members = [owner("o1")];
    expect(memberChangeIssue(members, { userId: "o1", role: "shop_owner" })).toBe("unchanged");
    expect(memberChangeIssue(members, { userId: "x", remove: true })).toBe("not_member");
  });
});
