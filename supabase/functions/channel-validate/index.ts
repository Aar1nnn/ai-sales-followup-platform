import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import {
  endpoint,
  jsonResponse,
  parseJsonBytes,
  readRawBody,
} from "../_shared/http.ts";
import { channelProvider } from "../_shared/providers/index.ts";
import { validateFeishuMemberIdentity } from "../_shared/providers/feishu.ts";
import type { ProviderConnection } from "../_shared/providers/types.ts";
import { validateSourceConnectionConfiguration } from "../_shared/source-config.ts";
import {
  adminClient,
  authenticatedUser,
  memberRole,
  vaultSecret,
} from "../_shared/supabase.ts";

Deno.serve((request) =>
  endpoint(request, async (id) => {
    const client = adminClient();
    const user = await authenticatedUser(request, client);
    const body = parseJsonBytes(await readRawBody(request, 32_768));
    const connectionId =
      typeof body.connection_id === "string" && body.connection_id
        ? body.connection_id
        : null;
    const organizationId = typeof body.organization_id === "string"
      ? body.organization_id
      : "";
    if (!organizationId) throw new AppError("VALIDATION_ERROR");
    const member = await memberRole(client, organizationId, user.id);
    if (!["owner", "admin"].includes(member.role)) {
      throw new AppError("FORBIDDEN");
    }

    if (body.resource_type === "source_connection") {
      if (body.operation !== "configure") {
        throw new AppError("VALIDATION_ERROR");
      }
      const configuration = validateSourceConnectionConfiguration(body);
      const { data, error } = await client.schema("crm").rpc(
        "configure_source_connection",
        {
          p_organization_id: organizationId,
          p_actor_user_id: user.id,
          p_connection_id: configuration.connectionId,
          p_provider: configuration.provider,
          p_name: configuration.name,
          p_external_source_id: configuration.externalSourceId,
          p_mapping: configuration.mapping,
          p_settings: configuration.settings,
          p_rate_limit_per_minute: configuration.rateLimitPerMinute,
          p_max_payload_bytes: configuration.maxPayloadBytes,
          p_secret: configuration.secret,
        },
      );
      if (error) throw fromDatabaseError(error);
      return jsonResponse(request, {
        ok: true,
        request_id: id,
        validation: { status: "configuration_valid" },
        configured: data,
      });
    }

    if (body.resource_type === "member_identity") {
      if (body.operation !== "verify") throw new AppError("VALIDATION_ERROR");
      const memberId = typeof body.member_id === "string" ? body.member_id : "";
      const openId = typeof body.feishu_open_id === "string"
        ? body.feishu_open_id.trim()
        : "";
      const idempotencyKey = typeof body.idempotency_key === "string"
        ? body.idempotency_key.trim()
        : "";
      const commandId = typeof body.command_id === "string"
        ? body.command_id
        : "";
      const occurredAt = typeof body.occurred_at === "string"
        ? body.occurred_at
        : "";
      if (
        !memberId || !openId || idempotencyKey.length < 8 || !commandId ||
        !occurredAt || Number.isNaN(Date.parse(occurredAt))
      ) {
        throw new AppError("VALIDATION_ERROR");
      }

      let query = client.from("channel_connections").select(
        "id,organization_id,provider,status,secret_ref,public_config",
      ).eq("organization_id", organizationId).eq("provider", "feishu_internal")
        .eq("status", "active");
      if (connectionId) query = query.eq("id", connectionId);
      const { data: connectionData, error: connectionError } = await query
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (connectionError || !connectionData) {
        throw new AppError("CONNECTION_INVALID");
      }
      const memberConnection = connectionData as ProviderConnection;
      const memberSecret = await vaultSecret(
        client,
        memberConnection.secret_ref,
      );
      const verified = await validateFeishuMemberIdentity(
        { connection: memberConnection, secret: memberSecret },
        openId,
      );
      const { data: command, error: commandError } = await client.schema("crm")
        .rpc("execute_admin_command", {
          p_envelope: {
            command_id: commandId,
            idempotency_key: idempotencyKey,
            command_name: "verify_member_channel_identity",
            organization_id: organizationId,
            actor_user_id: user.id,
            target_type: "organization_member",
            target_id: memberId,
            expected_version: null,
            source: "system",
            occurred_at: occurredAt,
            payload: {
              feishu_open_id: verified.open_id,
              feishu_user_id: verified.user_id,
            },
          },
        });
      if (commandError) throw fromDatabaseError(commandError);
      return jsonResponse(request, {
        ok: true,
        request_id: id,
        validation: {
          status: "verified",
          member_name: verified.name,
          feishu_open_id: verified.open_id,
        },
        command,
      });
    }

    let connection: ProviderConnection;
    if (connectionId) {
      const { data, error } = await client.from("channel_connections").select(
        "id,organization_id,provider,status,secret_ref,public_config",
      )
        .eq("organization_id", organizationId).eq("id", connectionId)
        .maybeSingle();
      if (error || !data) throw new AppError("NOT_FOUND");
      connection = data as ProviderConnection;
    } else {
      const provider = String(
        body.provider ?? "",
      ) as ProviderConnection["provider"];
      if (
        !["manual", "feishu_internal"].includes(provider)
      ) throw new AppError("PROVIDER_DISABLED");
      connection = {
        id: crypto.randomUUID(),
        organization_id: organizationId,
        provider,
        status: "draft",
        secret_ref: null,
        public_config: {},
      };
    }

    const credentials =
      body.credentials && typeof body.credentials === "object" &&
        !Array.isArray(body.credentials)
        ? body.credentials as Record<string, unknown>
        : null;
    const suppliedSecret = credentials ? JSON.stringify(credentials) : null;
    const secret = suppliedSecret ??
      await vaultSecret(client, connection.secret_ref);
    const provider = channelProvider(connection.provider);
    const validation = await provider.validateConnection({
      connection,
      secret,
    });
    let configured = null;
    if (body.operation === "configure") {
      const { data, error } = await client.schema("crm").rpc(
        "configure_channel_connection",
        {
          p_organization_id: organizationId,
          p_actor_user_id: user.id,
          p_connection_id: connectionId,
          p_provider: connection.provider,
          p_name: typeof body.name === "string" && body.name.trim()
            ? body.name.trim()
            : connection.provider,
          p_public_config:
            body.public_config && typeof body.public_config === "object"
              ? body.public_config
              : {},
          p_secret: suppliedSecret,
        },
      );
      if (error) throw fromDatabaseError(error);
      configured = data;
    }
    return jsonResponse(request, {
      ok: true,
      request_id: id,
      capabilities: provider.getCapabilities(),
      validation,
      configured,
    });
  })
);
