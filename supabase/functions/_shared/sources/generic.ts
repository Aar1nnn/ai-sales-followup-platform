import { AppError } from "../errors.ts";
import { verifyHmac, verifySharedSecret } from "../crypto.ts";
import { genericLeadIntake, secretValue } from "./common.ts";
import type { SourceAdapter } from "./types.ts";

export const genericWebhookAdapter: SourceAdapter = {
  async verify(context) {
    const token = context.request.headers.get("x-webhook-token");
    const signature = context.request.headers.get("x-webhook-signature");
    const expectedToken = secretValue(context.secret, "token");
    const hmacSecret = secretValue(context.secret, "hmac_secret");
    if (signature && hmacSecret) {
      await verifyHmac(hmacSecret, context.rawBody, signature);
      return;
    }
    if (token && expectedToken) {
      verifySharedSecret(expectedToken, token);
      return;
    }
    throw new AppError("SIGNATURE_INVALID");
  },
  normalize(context) {
    return genericLeadIntake(
      context.connection,
      context.payload,
      context.receivedAt,
    );
  },
};

export const internalManualAdapter: SourceAdapter = {
  async verify(context) {
    verifySharedSecret(
      secretValue(context.secret, "token") ?? undefined,
      context.request.headers.get("x-webhook-token"),
    );
  },
  normalize(context) {
    return genericLeadIntake(
      context.connection,
      context.payload,
      context.receivedAt,
    );
  },
};

export const builtinFormAdapter: SourceAdapter = {
  async verify(context) {
    if (Deno.env.get("ENABLE_BUILTIN_TEST_FORM") !== "true") {
      throw new AppError("PROVIDER_DISABLED");
    }
    verifySharedSecret(
      secretValue(context.secret, "token") ?? undefined,
      context.request.headers.get("x-webhook-token"),
    );
  },
  normalize(context) {
    return genericLeadIntake(
      context.connection,
      context.payload,
      context.receivedAt,
    );
  },
};
