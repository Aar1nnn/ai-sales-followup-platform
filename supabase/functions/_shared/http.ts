import { AppError } from "./errors.ts";

function allowedOrigin(request: Request): string {
  const origin = request.headers.get("origin") ?? "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin)
    ? origin
    : allowed[0] ?? "http://localhost:5173";
}

function responseHeaders(request: Request): HeadersInit {
  return {
    "access-control-allow-origin": allowedOrigin(request),
    "access-control-allow-headers":
      "authorization, x-client-info, apikey, content-type, x-retry-count, x-internal-secret, x-webhook-token, x-webhook-signature, x-tally-signature, tally-signature, x-lark-request-timestamp, x-lark-request-nonce, x-lark-signature",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    vary: "Origin",
  };
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._:-]{8,120}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export async function readRawBody(
  request: Request,
  maxBytes = 262_144,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError("VALIDATION_ERROR", "Payload is too large.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new AppError("VALIDATION_ERROR", "Payload is too large.");
  }
  return bytes;
}

export function parseJsonBytes(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("object required");
    }
    return value;
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
    );
  }
}

export async function endpoint(
  request: Request,
  handler: (requestId: string) => Promise<Response>,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders(request),
    });
  }
  const id = requestId(request);
  try {
    if (request.method !== "POST") {
      throw new AppError("VALIDATION_ERROR", "Only POST is supported.");
    }
    return await handler(id);
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError(
      "TRANSIENT_PROVIDER_ERROR",
      "The request could not be completed.",
      true,
    );
    console.error(
      JSON.stringify({
        request_id: id,
        code: appError.code,
        retryable: appError.retryable,
      }),
    );
    return jsonResponse(request, {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        retryable: appError.retryable,
      },
      request_id: id,
    }, appError.status);
  }
}
