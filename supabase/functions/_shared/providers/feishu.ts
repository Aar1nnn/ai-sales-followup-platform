import { constantTimeEqual, sha256Hex } from "../crypto.ts";
import { AppError } from "../errors.ts";
import type {
  ChannelProvider,
  ProviderContext,
  ProviderResult,
} from "./types.ts";

interface FeishuSecret {
  app_id: string;
  app_secret: string;
  verification_token: string;
  encrypt_key?: string;
}

export interface FeishuMemberIdentity {
  open_id: string;
  user_id: string | null;
  name: string | null;
}

export function parseFeishuMemberIdentity(
  body: Record<string, unknown>,
  requestedOpenId: string,
): FeishuMemberIdentity {
  const data = body.data as Record<string, unknown> | undefined;
  const user = data?.user as Record<string, unknown> | undefined;
  const status = user?.status as Record<string, unknown> | undefined;
  const openId = typeof user?.open_id === "string" ? user.open_id.trim() : "";
  if (
    !user || !openId || openId !== requestedOpenId ||
    status?.is_activated === false || status?.is_frozen === true ||
    status?.is_resigned === true
  ) {
    throw new AppError("CONNECTION_INVALID", "Feishu member is unavailable.");
  }
  return {
    open_id: openId,
    user_id: typeof user.user_id === "string" && user.user_id.trim()
      ? user.user_id.trim()
      : null,
    name: typeof user.name === "string" && user.name.trim()
      ? user.name.trim()
      : null,
  };
}

function credentials(context: ProviderContext): FeishuSecret {
  try {
    const parsed = JSON.parse(context.secret ?? "") as FeishuSecret;
    if (!parsed.app_id || !parsed.app_secret || !parsed.verification_token) {
      throw new Error("missing values");
    }
    return parsed;
  } catch {
    throw new AppError("CONNECTION_INVALID");
  }
}

async function tenantToken(secret: FeishuSecret): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: secret.app_id,
          app_secret: secret.app_secret,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new AppError(
      "TRANSIENT_PROVIDER_ERROR",
      "Feishu is temporarily unavailable.",
      true,
    );
  }
  const body = await response.json() as Record<string, unknown>;
  if (
    !response.ok || body.code !== 0 ||
    typeof body.tenant_access_token !== "string"
  ) throw new AppError("CONNECTION_INVALID");
  return body.tenant_access_token;
}

async function feishuRequest(
  secret: FeishuSecret,
  path: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const token = await tenantToken(secret);
  let response: Response;
  try {
    response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      "TRANSIENT_PROVIDER_ERROR",
      "Feishu is temporarily unavailable.",
      true,
    );
  }
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || body.code !== 0) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new AppError(
      retryable ? "TRANSIENT_PROVIDER_ERROR" : "CONNECTION_INVALID",
      retryable
        ? "Feishu is temporarily unavailable."
        : "Feishu rejected the request.",
      retryable,
    );
  }
  return body;
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function decryptFeishuPayload(
  encrypted: string,
  encryptKey: string,
): Promise<Record<string, unknown>> {
  try {
    const keyBytes = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(encryptKey),
      ),
    );
    const bytes = base64Bytes(encrypted);
    const iv = bytes.slice(0, 16);
    const ciphertext = bytes.slice(16);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CBC" },
      false,
      ["decrypt"],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      key,
      ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as Record<
      string,
      unknown
    >;
  } catch {
    throw new AppError("SIGNATURE_INVALID");
  }
}

export async function updateFeishuCard(
  context: ProviderContext,
  messageId: string,
  card: Record<string, unknown>,
): Promise<ProviderResult> {
  const secret = credentials(context);
  await feishuRequest(
    secret,
    `/im/v1/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ content: JSON.stringify(card) }),
    },
  );
  return {
    ok: true,
    provider: "feishu_internal",
    external_id: messageId,
    status: "updated",
  };
}

export async function validateFeishuMemberIdentity(
  context: ProviderContext,
  openId: string,
): Promise<FeishuMemberIdentity> {
  const normalizedOpenId = openId.trim();
  if (normalizedOpenId.length < 3 || normalizedOpenId.length > 160) {
    throw new AppError("VALIDATION_ERROR");
  }
  const body = await feishuRequest(
    credentials(context),
    `/contact/v3/users/${
      encodeURIComponent(normalizedOpenId)
    }?user_id_type=open_id`,
    { method: "GET" },
  );
  return parseFeishuMemberIdentity(body, normalizedOpenId);
}

export const feishuProvider: ChannelProvider = {
  async validateConnection(context) {
    await tenantToken(credentials(context));
    return { ok: true, provider: "feishu_internal", status: "valid" };
  },
  async sendInternalNotification(context, payload) {
    const openId = typeof payload.feishu_open_id === "string"
      ? payload.feishu_open_id
      : "";
    const chatId = typeof payload.feishu_chat_id === "string"
      ? payload.feishu_chat_id
      : "";
    if (!openId && !chatId) throw new AppError("VALIDATION_ERROR");
    const card = payload.card && typeof payload.card === "object"
      ? payload.card
      : {
        config: { wide_screen_mode: true },
        elements: [{
          tag: "div",
          text: {
            tag: "lark_md",
            content: String(payload.text ?? "新客户待跟进"),
          },
        }],
      };
    const receiveId = openId || chatId;
    const receiveType = openId ? "open_id" : "chat_id";
    const body = await feishuRequest(
      credentials(context),
      `/im/v1/messages?receive_id_type=${receiveType}`,
      {
        method: "POST",
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: "interactive",
          content: JSON.stringify(card),
        }),
      },
    );
    const data = body.data as Record<string, unknown> | undefined;
    return {
      ok: true,
      provider: "feishu_internal",
      external_id: String(data?.message_id ?? ""),
      status: "sent",
    };
  },
  async sendApprovedCustomerMessage() {
    throw new AppError(
      "PROVIDER_DISABLED",
      "Feishu Internal does not send customer messages.",
    );
  },
  async verifyWebhookSignature(context, request, rawBody) {
    const secret = credentials(context);
    const timestamp = request.headers.get("x-lark-request-timestamp");
    const nonce = request.headers.get("x-lark-request-nonce");
    const supplied = request.headers.get("x-lark-signature");
    if (!timestamp || !nonce || !supplied || !secret.encrypt_key) {
      throw new AppError("SIGNATURE_INVALID");
    }
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) {
      throw new AppError("SIGNATURE_INVALID");
    }
    const raw = new TextDecoder().decode(rawBody);
    const expected = await sha256Hex(
      `${timestamp}${nonce}${secret.encrypt_key}${raw}`,
    );
    if (!constantTimeEqual(expected, supplied)) {
      throw new AppError("SIGNATURE_INVALID");
    }
  },
  async receiveWebhook(context, request, rawBody) {
    await this.verifyWebhookSignature(context, request, rawBody);
    const parsed = JSON.parse(new TextDecoder().decode(rawBody)) as Record<
      string,
      unknown
    >;
    if (typeof parsed.encrypt === "string") {
      const secret = credentials(context);
      if (!secret.encrypt_key) throw new AppError("SIGNATURE_INVALID");
      return decryptFeishuPayload(parsed.encrypt, secret.encrypt_key);
    }
    const token = parsed.token;
    if (
      typeof token === "string" &&
      !constantTimeEqual(token, credentials(context).verification_token)
    ) throw new AppError("SIGNATURE_INVALID");
    return parsed;
  },
  normalizeInboundMessage(payload) {
    const event = payload.event as Record<string, unknown> | undefined;
    return {
      event_id: (payload.header as Record<string, unknown> | undefined)
        ?.event_id,
      event_type: (payload.header as Record<string, unknown> | undefined)
        ?.event_type,
      event,
    };
  },
  normalizeDeliveryEvent(payload) {
    return this.normalizeInboundMessage(payload);
  },
  getCapabilities() {
    return {
      internal_notification: true,
      approved_customer_message: false,
      inbound_webhook: true,
      delivery_events: true,
      automatic_customer_send: false,
    };
  },
};
