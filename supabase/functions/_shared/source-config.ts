import { AppError } from "./errors.ts";

export type ConfigurableSourceProvider =
  | "tally"
  | "generic_webhook"
  | "internal_manual";

export interface SourceConnectionConfiguration {
  connectionId: string | null;
  provider: ConfigurableSourceProvider;
  name: string;
  externalSourceId: string | null;
  mapping: Record<string, unknown>;
  settings: Record<string, unknown>;
  rateLimitPerMinute: number;
  maxPayloadBytes: number;
  secret: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR");
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function validateSourceConnectionConfiguration(
  body: Record<string, unknown>,
): SourceConnectionConfiguration {
  const provider = String(body.provider ?? "") as ConfigurableSourceProvider;
  if (!["tally", "generic_webhook", "internal_manual"].includes(provider)) {
    throw new AppError("PROVIDER_DISABLED");
  }
  const name = optionalText(body.name);
  const externalSourceId = optionalText(body.external_source_id);
  if (!name || (provider === "tally" && !externalSourceId)) {
    throw new AppError("VALIDATION_ERROR");
  }
  const credentials = record(body.credentials);
  const token = optionalText(credentials.token);
  const hmacSecret = optionalText(credentials.hmac_secret);
  if (
    (provider === "tally" && !hmacSecret) ||
    (provider === "internal_manual" && !token) ||
    (provider === "generic_webhook" && !token && !hmacSecret)
  ) throw new AppError("VALIDATION_ERROR");

  const rateLimitPerMinute = Number(body.rate_limit_per_minute ?? 60);
  const maxPayloadBytes = Number(body.max_payload_bytes ?? 262_144);
  if (
    !Number.isSafeInteger(rateLimitPerMinute) || rateLimitPerMinute < 1 ||
    rateLimitPerMinute > 10_000 ||
    !Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1_024 ||
    maxPayloadBytes > 1_048_576
  ) throw new AppError("VALIDATION_ERROR");

  return {
    connectionId: optionalText(body.connection_id),
    provider,
    name,
    externalSourceId,
    mapping: record(body.mapping ?? {}),
    settings: record(body.settings ?? {}),
    rateLimitPerMinute,
    maxPayloadBytes,
    secret: JSON.stringify(credentials),
  };
}
