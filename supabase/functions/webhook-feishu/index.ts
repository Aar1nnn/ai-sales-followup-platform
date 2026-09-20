import { constantTimeEqual, sha256Hex } from "../_shared/crypto.ts";
import type { CommandEnvelope } from "../_shared/contracts.ts";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import {
  endpoint,
  jsonResponse,
  parseJsonBytes,
  readRawBody,
} from "../_shared/http.ts";
import {
  feishuProvider,
  updateFeishuCard,
} from "../_shared/providers/feishu.ts";
import type { ProviderConnection } from "../_shared/providers/types.ts";
import { adminClient, vaultSecret } from "../_shared/supabase.ts";

const allowedCardCommands = new Set([
  "accept_lead",
  "acknowledge_lead",
  "record_outcome",
  "schedule_follow_up",
  "snooze_follow_up",
  "approve_message_draft",
  "mark_manual_message_sent",
  "mark_opportunity_won",
  "mark_lead_invalid",
]);

function connectionPublicId(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const index = parts.lastIndexOf("webhook-feishu");
  const value = index >= 0 ? parts[index + 1] : null;
  if (!value || !/^[a-f0-9]{20,64}$/i.test(value)) {
    throw new AppError("NOT_FOUND");
  }
  return value;
}

async function stableUuid(value: string): Promise<string> {
  const hex = await sha256Hex(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${
    hex.slice(17, 20)
  }-${hex.slice(20, 32)}`;
}

function secretToken(secret: string | null): string {
  try {
    return String(
      (JSON.parse(secret ?? "") as Record<string, unknown>)
        .verification_token ?? "",
    );
  } catch {
    return "";
  }
}

Deno.serve((request) =>
  endpoint(request, async (id) => {
    const client = adminClient();
    const publicId = connectionPublicId(request);
    const { data, error } = await client.from("channel_connections")
      .select("id,organization_id,provider,status,secret_ref,public_config")
      .eq("public_id", publicId).eq("provider", "feishu_internal").eq(
        "status",
        "active",
      ).maybeSingle();
    if (error || !data) throw new AppError("CONNECTION_INVALID");
    const connection = data as ProviderConnection;
    const context = {
      connection,
      secret: await vaultSecret(client, connection.secret_ref),
    };
    const rawBody = await readRawBody(request);
    const initial = parseJsonBytes(rawBody);

    if (initial.type === "url_verification") {
      const token = typeof initial.token === "string" ? initial.token : "";
      if (
        !token || !constantTimeEqual(token, secretToken(context.secret))
      ) throw new AppError("SIGNATURE_INVALID");
      return jsonResponse(request, { challenge: initial.challenge });
    }

    const payload = await feishuProvider.receiveWebhook(
      context,
      request,
      rawBody,
    );
    const event = payload.event as Record<string, unknown> | undefined;
    const header = payload.header as Record<string, unknown> | undefined;
    const action = event?.action as Record<string, unknown> | undefined;
    const value = action?.value as Record<string, unknown> | undefined;
    const operator = event?.operator as Record<string, unknown> | undefined;
    const openId = typeof operator?.open_id === "string"
      ? operator.open_id
      : "";
    const eventId = typeof header?.event_id === "string" ? header.event_id : id;

    if (
      !value || !openId || typeof value.command_name !== "string" ||
      !allowedCardCommands.has(value.command_name)
    ) {
      return jsonResponse(request, {
        ok: true,
        request_id: id,
        status: "ignored",
      });
    }

    const { data: identity, error: identityError } = await client.from(
      "organization_member_channel_identities",
    )
      .select("member_id,status")
      .eq("organization_id", connection.organization_id).eq(
        "provider",
        "feishu_internal",
      )
      .eq("feishu_open_id", openId).eq("status", "verified").maybeSingle();
    if (identityError || !identity) throw new AppError("FORBIDDEN");
    const { data: member, error: memberError } = await client.from(
      "organization_members",
    )
      .select("user_id,status").eq(
        "organization_id",
        connection.organization_id,
      )
      .eq("id", identity.member_id).eq("status", "active").maybeSingle();
    if (memberError || !member) throw new AppError("FORBIDDEN");

    const envelope: CommandEnvelope = {
      command_id: await stableUuid(
        `${eventId}:${String(action?.tag ?? "action")}`,
      ),
      idempotency_key: `feishu:${eventId}:${String(action?.tag ?? "action")}`,
      command_name: value.command_name,
      organization_id: connection.organization_id,
      actor_user_id: member.user_id,
      target_type: String(value.target_type ?? "lead"),
      target_id: typeof value.target_id === "string" ? value.target_id : null,
      expected_version: typeof value.expected_version === "number"
        ? value.expected_version
        : Number(value.expected_version ?? 0) || null,
      source: "feishu",
      occurred_at: new Date().toISOString(),
      payload: value.payload && typeof value.payload === "object" &&
          !Array.isArray(value.payload)
        ? value.payload as Record<string, unknown>
        : {},
    };
    const contextValue = event?.context as Record<string, unknown> | undefined;
    const messageId = typeof contextValue?.open_message_id === "string"
      ? contextValue.open_message_id
      : null;
    const { data: result, error: commandError } = await client.schema("crm")
      .rpc("execute_command", { p_envelope: envelope });
    if (commandError) {
      const appError = fromDatabaseError(commandError);
      if (appError.code === "VERSION_CONFLICT" && messageId) {
        const crmBaseUrl = (Deno.env.get("CRM_APP_URL") ?? "").replace(
          /\/$/,
          "",
        );
        const elements: Record<string, unknown>[] = [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content:
                "⚠️ 卡片已过期：记录已被其他操作更新。请打开 CRM 刷新后重试。",
            },
          },
        ];
        if (
          crmBaseUrl && value.target_type === "lead" &&
          typeof value.target_id === "string"
        ) {
          elements.push({
            tag: "action",
            actions: [{
              tag: "button",
              type: "primary",
              text: { tag: "plain_text", content: "打开最新 CRM 记录" },
              url: `${crmBaseUrl}/leads/${value.target_id}`,
            }],
          });
        }
        await updateFeishuCard(context, messageId, {
          config: { wide_screen_mode: true },
          elements,
        });
        return jsonResponse(request, {
          ok: false,
          request_id: id,
          error: {
            code: appError.code,
            message: "卡片版本已过期，请刷新 CRM 后重试。",
            retryable: false,
          },
        }, appError.status);
      }
      throw appError;
    }

    if (messageId) {
      await updateFeishuCard(context, messageId, {
        config: { wide_screen_mode: true },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: `✅ 操作已完成：**${value.command_name}**`,
            },
          },
          {
            tag: "note",
            elements: [{
              tag: "plain_text",
              content: "卡片操作已锁定。如需继续编辑，请打开 CRM。",
            }],
          },
        ],
      });
    }
    return jsonResponse(request, { ok: true, request_id: id, result });
  })
);
