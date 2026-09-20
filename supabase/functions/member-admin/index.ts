import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import {
  endpoint,
  jsonResponse,
  parseJsonBytes,
  readRawBody,
} from "../_shared/http.ts";
import { parseMemberInvitation } from "../_shared/member-invite.ts";
import {
  adminClient,
  authenticatedUser,
  memberRole,
} from "../_shared/supabase.ts";

function invitationRedirectUrl(): string | undefined {
  const configured = Deno.env.get("MEMBER_INVITE_REDIRECT_URL") ??
    Deno.env.get("CRM_APP_URL");
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    return url.pathname === "/" ? `${url.origin}/login` : url.toString();
  } catch {
    return undefined;
  }
}

Deno.serve((request) =>
  endpoint(request, async (requestId) => {
    const client = adminClient();
    const user = await authenticatedUser(request, client);
    const body = parseJsonBytes(await readRawBody(request, 32_768));
    if (body.operation !== "invite") throw new AppError("VALIDATION_ERROR");
    const input = parseMemberInvitation(body);
    const actor = await memberRole(client, input.organizationId, user.id);
    if (!["owner", "admin"].includes(actor.role)) {
      throw new AppError("FORBIDDEN");
    }

    const { data: prepared, error: prepareError } = await client.schema("crm")
      .rpc("prepare_member_invitation", {
        p_organization_id: input.organizationId,
        p_actor_user_id: user.id,
        p_email: input.email,
        p_display_name: input.displayName,
        p_job_title: input.jobTitle,
        p_role: input.role,
        p_accepts_assignments: input.acceptsAssignments,
        p_idempotency_key: input.idempotencyKey,
      });
    if (prepareError) throw fromDatabaseError(prepareError);
    const invitation = prepared as Record<string, unknown>;
    if (invitation.status === "provisioned") {
      return jsonResponse(request, {
        ok: true,
        request_id: requestId,
        delivery: "already_provisioned",
        invitation: {
          invitation_id: invitation.invitation_id,
          status: invitation.status,
        },
      });
    }

    const invitationId = String(invitation.invitation_id);
    try {
      let authUserId = typeof invitation.auth_user_id === "string"
        ? invitation.auth_user_id
        : null;
      let delivery = "existing_user";
      if (!authUserId) {
        const { data, error } = await client.auth.admin.inviteUserByEmail(
          String(invitation.email),
          {
            redirectTo: invitationRedirectUrl(),
            data: {
              display_name: invitation.display_name,
              organization_id: invitation.organization_id,
              requires_password_setup: true,
            },
          },
        );
        if (error || !data.user) {
          if (error?.status === 429) {
            throw new AppError("RATE_LIMITED", undefined, true);
          }
          throw new AppError(
            "CONNECTION_INVALID",
            "Invitation email could not be sent.",
          );
        }
        authUserId = data.user.id;
        delivery = "email_sent";
      }

      const { data: command, error: commandError } = await client.schema("crm")
        .rpc("execute_admin_command", {
          p_envelope: {
            command_id: invitationId,
            idempotency_key: `member-provision:${invitationId}`,
            command_name: "provision_organization_member",
            organization_id: invitation.organization_id,
            actor_user_id: user.id,
            target_type: "organization_invitation",
            target_id: invitationId,
            expected_version: invitation.version,
            source: "system",
            occurred_at: invitation.created_at,
            payload: { auth_user_id: authUserId },
          },
        });
      if (commandError) {
        throw fromDatabaseError(commandError);
      }
      return jsonResponse(request, {
        ok: true,
        request_id: requestId,
        delivery,
        invitation_id: invitationId,
        command,
      }, 201);
    } catch (error) {
      const safeError = error instanceof AppError
        ? error
        : new AppError("CONNECTION_INVALID");
      await client.schema("crm").rpc("fail_member_invitation", {
        p_invitation_id: invitationId,
        p_error_code: safeError.code,
        p_error_message: safeError.message,
      });
      throw safeError;
    }
  })
);
