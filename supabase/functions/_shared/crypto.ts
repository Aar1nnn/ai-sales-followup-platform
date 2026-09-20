import { AppError } from "./errors.ts";

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function sha256Hex(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", copyToArrayBuffer(bytes)),
    ),
  );
}

export async function hmacSha256(
  secret: string,
  bytes: Uint8Array,
): Promise<{ hex: string; base64: string }> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, copyToArrayBuffer(bytes)),
  );
  return { hex: bytesToHex(signature), base64: bytesToBase64(signature) };
}

export function constantTimeEqual(first: string, second: string): boolean {
  const a = encoder.encode(first);
  const b = encoder.encode(second);
  const size = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyHmac(
  secret: string,
  bytes: Uint8Array,
  supplied: string | null,
): Promise<void> {
  if (!secret || !supplied) throw new AppError("SIGNATURE_INVALID");
  const expected = await hmacSha256(secret, bytes);
  const normalized = supplied.replace(/^sha256=/i, "").trim();
  if (
    !constantTimeEqual(expected.hex, normalized) &&
    !constantTimeEqual(expected.base64, normalized)
  ) {
    throw new AppError("SIGNATURE_INVALID");
  }
}

export function verifySharedSecret(
  expected: string | undefined,
  supplied: string | null,
): void {
  if (!expected || !supplied || !constantTimeEqual(expected, supplied)) {
    throw new AppError("UNAUTHENTICATED");
  }
}
