import { AppError } from "./errors.ts";

export interface MemberInvitationInput {
  organizationId: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  role: "admin" | "manager" | "sales";
  acceptsAssignments: boolean;
  idempotencyKey: string;
}

export function parseMemberInvitation(
  body: Record<string, unknown>,
): MemberInvitationInput {
  const organizationId = typeof body.organization_id === "string"
    ? body.organization_id.trim()
    : "";
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  const displayName = typeof body.display_name === "string"
    ? body.display_name.trim()
    : "";
  const jobTitle = typeof body.job_title === "string" && body.job_title.trim()
    ? body.job_title.trim()
    : null;
  const role = body.role;
  const idempotencyKey = typeof body.idempotency_key === "string"
    ? body.idempotency_key.trim()
    : "";
  if (
    !organizationId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 320 || displayName.length < 1 || displayName.length > 120 ||
    !["admin", "manager", "sales"].includes(String(role)) ||
    idempotencyKey.length < 8 || idempotencyKey.length > 200
  ) throw new AppError("VALIDATION_ERROR");
  return {
    organizationId,
    email,
    displayName,
    jobTitle,
    role: role as MemberInvitationInput["role"],
    acceptsAssignments: body.accepts_assignments !== false,
    idempotencyKey,
  };
}
