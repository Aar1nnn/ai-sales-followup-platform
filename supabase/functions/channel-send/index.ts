import { verifySharedSecret } from "../_shared/crypto.ts";
import { AppError } from "../_shared/errors.ts";
import {
  endpoint,
  jsonResponse,
  parseJsonBytes,
  readRawBody,
} from "../_shared/http.ts";
import { channelProvider } from "../_shared/providers/index.ts";
import type { ProviderConnection } from "../_shared/providers/types.ts";
import { adminClient, vaultSecret } from "../_shared/supabase.ts";

Deno.serve((request) =>
  endpoint(request, async (id) => {
    verifySharedSecret(
      Deno.env.get("N8N_INTERNAL_SECRET"),
      request.headers.get("x-internal-secret"),
    );
    const body = parseJsonBytes(await readRawBody(request));
    const connectionId = typeof body.connection_id === "string"
      ? body.connection_id
      : "";
    const action = body.action;
    if (
      !connectionId ||
      !["internal_notification", "approved_customer_message"].includes(
        String(action),
      )
    ) throw new AppError("VALIDATION_ERROR");
    const client = adminClient();
    const { data, error } = await client.from("channel_connections").select(
      "id,organization_id,provider,status,secret_ref,public_config",
    )
      .eq("id", connectionId).eq("status", "active").maybeSingle();
    if (error || !data) throw new AppError("CONNECTION_INVALID");
    const connection = data as ProviderConnection;
    const context = {
      connection,
      secret: await vaultSecret(client, connection.secret_ref),
    };
    const provider = channelProvider(connection.provider);
    const payload = body.payload && typeof body.payload === "object" &&
        !Array.isArray(body.payload)
      ? body.payload as Record<string, unknown>
      : {};
    const result = action === "internal_notification"
      ? await provider.sendInternalNotification(context, payload)
      : await provider.sendApprovedCustomerMessage(context, payload);
    return jsonResponse(request, { ok: true, request_id: id, result });
  })
);
