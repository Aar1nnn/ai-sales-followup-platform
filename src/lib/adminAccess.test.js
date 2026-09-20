import { describe, expect, it } from "vitest";
import {
  allowedMemberRoles,
  canAdministerOrganization,
  canManageFeishuIdentity,
  canManageMember,
  eligibleReplacements,
} from "./adminAccess";

describe("admin access rules", () => {
  it("only Owner and Admin administer organization operations", () => {
    expect(canAdministerOrganization("owner")).toBe(true);
    expect(canAdministerOrganization("admin")).toBe(true);
    expect(canAdministerOrganization("manager")).toBe(false);
  });

  it("Admin cannot manage Owner/Admin or grant Admin", () => {
    expect(canManageMember("admin", "owner")).toBe(false);
    expect(canManageMember("admin", "admin")).toBe(false);
    expect(canManageMember("admin", "sales")).toBe(true);
    expect(allowedMemberRoles("admin")).toEqual(["manager", "sales"]);
  });

  it("replacement candidates are active and accepting Sales", () => {
    const members = [
      { id: "a", role: "sales", status: "active", accepts_assignments: true, is_away: false },
      { id: "b", role: "sales", status: "active", accepts_assignments: true, is_away: true },
      { id: "c", role: "manager", status: "active", accepts_assignments: true, is_away: false },
    ];
    expect(eligibleReplacements(members, "x").map((member) => member.id)).toEqual(["a"]);
  });

  it("Admin can map self but cannot map another Admin", () => {
    expect(canManageFeishuIdentity("admin", "a", "admin", "a")).toBe(true);
    expect(canManageFeishuIdentity("admin", "a", "admin", "b")).toBe(false);
    expect(canManageFeishuIdentity("owner", "o", "owner", "o")).toBe(true);
  });
});
