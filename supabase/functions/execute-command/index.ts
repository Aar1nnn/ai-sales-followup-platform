import { parseCommandEnvelope } from "../_shared/contracts.ts";
import { fromDatabaseError } from "../_shared/errors.ts";
import { verifySharedSecret } from "../_shared/crypto.ts";
import { assuranceLevelFromValidatedJwt } from "../_shared/jwt.ts";
import {
  endpoint,
  jsonResponse,
  parseJsonBytes,
  readRawBody,
} from "../_shared/http.ts";
import { adminClient, authenticatedUser } from "../_shared/supabase.ts";

function accessToken(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ??
    null;
}

const browserAdminCommands = new Set([
  "update_organization_member",
  "deactivate_organization_member",
  "reactivate_organization_member",
  "remove_member_channel_identity",
  "retry_outbox_event",
]);

Deno.serve((request) =>
  endpoint(request, async (id) => {
    const body = parseJsonBytes(await readRawBody(request));
    const envelope = parseCommandEnvelope(body);
    const client = adminClient();
    const internalSecret = request.headers.get("x-internal-secret");

    if (internalSecret) {
      verifySharedSecret(Deno.env.get("N8N_INTERNAL_SECRET"), internalSecret);
      const systemActor = Deno.env.get("SYSTEM_ACTOR_USER_ID");
      if (!systemActor) throw new Error("SYSTEM_ACTOR_USER_ID is missing");
      envelope.actor_user_id = systemActor;
      envelope.source = "n8n";
    } else {
      const user = await authenticatedUser(request, client);
      envelope.actor_user_id = user.id;
      envelope.source = "crm";
      if (
        envelope.command_name === "request_organization_deletion" ||
        envelope.command_name === "cancel_organization_deletion"
      ) {
        envelope.payload.verified_aal = assuranceLevelFromValidatedJwt(
          accessToken(request),
        );
      }
    }

    const rpc = browserAdminCommands.has(envelope.command_name)
      ? "execute_admin_command"
      : "execute_command";
    const { data, error } = await client.schema("crm").rpc(rpc, {
      p_envelope: envelope,
    });
    if (error) throw fromDatabaseError(error);
    return jsonResponse(request, { ...data, request_id: id });
  })
);
