export function canAdministerOrganization(role) {
  return role === "owner" || role === "admin";
}

export function canManageMember(actorRole, targetRole) {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && targetRole !== "admin";
}

export function allowedMemberRoles(actorRole) {
  return actorRole === "owner"
    ? ["admin", "manager", "sales"]
    : ["manager", "sales"];
}

export function canManageFeishuIdentity(
  actorRole,
  actorMemberId,
  targetRole,
  targetMemberId,
) {
  if (actorRole === "owner") return true;
  if (actorRole !== "admin" || targetRole === "owner") return false;
  return targetRole !== "admin" || actorMemberId === targetMemberId;
}

export function eligibleReplacements(members, targetId) {
  return members.filter((member) =>
    member.id !== targetId && member.role === "sales" &&
    member.status === "active" && member.accepts_assignments && !member.is_away
  );
}
