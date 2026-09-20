import {
  validateAuthenticatedManualLeadInput,
  validateLeadIntake,
} from "../_shared/contracts.ts";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import {
  endpoint,
  jsonResponse,
  parseJsonBytes,
  readRawBody,
} from "../_shared/http.ts";
import { sourceAdapter } from "../_shared/sources/index.ts";
import type { SourceConnection } from "../_shared/sources/types.ts";
import {
  adminClient,
  authenticatedUser,
  memberRole,
  vaultSecret,
} from "../_shared/supabase.ts";

function connectionRouteSegment(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const index = parts.lastIndexOf("lead-intake");
  const value = index >= 0 ? parts[index + 1] : null;
  if (!value || (value !== "manual" && !/^[a-f0-9]{20,64}$/i.test(value))) {
    throw new AppError("NOT_FOUND");
  }
  return value;
}

Deno.serve((request) =>
  endpoint(request, async (id) => {
    const client = adminClient();
    const routeSegment = connectionRouteSegment(request);
    const isAuthenticatedManual = routeSegment === "manual";
    let connection: SourceConnection & { status: string };
    let rawBody: Uint8Array;
    let payload: Record<string, unknown>;
    let secret: string | null = null;
    let actorUserId: string | null = null;
    let actorMemberId: string | null = null;

    if (isAuthenticatedManual) {
      const user = await authenticatedUser(request, client);
      rawBody = await readRawBody(request, 32_768);
      payload = parseJsonBytes(rawBody);
      const organizationId = validateAuthenticatedManualLeadInput(payload);
      const membership = await memberRole(client, organizationId, user.id);
      actorUserId = user.id;
      actorMemberId = membership.id;

      const { data: ensured, error: ensureError } = await client.schema("crm")
        .rpc("ensure_authenticated_manual_source", {
          p_organization_id: organizationId,
        });
      if (ensureError) throw fromDatabaseError(ensureError);
      if (!ensured?.connection_id) throw new AppError("CONNECTION_INVALID");
      const { data, error } = await client
        .from("lead_source_connections")
        .select(
          "id,public_id,organization_id,provider,external_source_id,mapping,settings,max_payload_bytes,secret_ref,status",
        )
        .eq("id", ensured.connection_id)
        .eq("status", "active")
        .maybeSingle();
      if (error || !data) throw new AppError("CONNECTION_INVALID");
      connection = data as SourceConnection & { status: string };
    } else {
      const { data, error } = await client
        .from("lead_source_connections")
        .select(
          "id,public_id,organization_id,provider,external_source_id,mapping,settings,max_payload_bytes,secret_ref,status",
        )
        .eq("public_id", routeSegment)
        .eq("status", "active")
        .maybeSingle();
      if (error || !data) throw new AppError("CONNECTION_INVALID");
      connection = data as SourceConnection & { status: string };
      rawBody = await readRawBody(request, connection.max_payload_bytes);
      payload = parseJsonBytes(rawBody);
      secret = await vaultSecret(client, connection.secret_ref);
    }

    const adapter = sourceAdapter(connection.provider);
    const receivedAt = new Date().toISOString();
    const context = {
      connection,
      request,
      rawBody,
      payload,
      secret,
      receivedAt,
    };
    if (!isAuthenticatedManual) await adapter.verify(context);

    const { data: allowed, error: limitError } = await client.schema("crm").rpc(
      "check_intake_rate_limit",
      { p_connection_id: connection.id },
    );
    if (limitError) throw fromDatabaseError(limitError);
    if (!allowed) {
      throw new AppError("RATE_LIMITED", "Too many requests.", true);
    }

    const adapted = adapter.normalize(context);
    if (isAuthenticatedManual) {
      adapted.metadata = {
        ...adapted.metadata,
        intake_mode: "authenticated_manual",
        created_by_user_id: actorUserId,
        created_by_member_id: actorMemberId,
      };
    }
    const normalized = validateLeadIntake(
      adapted,
      connection.organization_id,
      connection.id,
    );
    const rpcName = isAuthenticatedManual
      ? "intake_authenticated_manual_lead"
      : "intake_lead";
    const rpcArguments = {
      p_connection_id: connection.id,
      p_source_event_id: normalized.source_event_id,
      p_received_at: normalized.received_at,
      p_raw_payload: payload,
      p_normalized_payload: normalized,
      p_payload_sha256: await sha256Hex(rawBody),
      ...(isAuthenticatedManual ? { p_actor_user_id: actorUserId } : {}),
    };
    const { data: result, error: intakeError } = await client.schema("crm").rpc(
      rpcName,
      rpcArguments,
    );
    if (intakeError) throw fromDatabaseError(intakeError);
    return jsonResponse(request, {
      ...result,
      request_id: result.request_id ?? id,
    }, 202);
  })
);
