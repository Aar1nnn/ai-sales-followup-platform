export const errorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "ORGANIZATION_INACTIVE",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "PROVIDER_DISABLED",
  "PROVIDER_NOT_IMPLEMENTED",
  "CONNECTION_INVALID",
  "SIGNATURE_INVALID",
  "RATE_LIMITED",
  "TRANSIENT_PROVIDER_ERROR",
  "MANUAL_ACTION_REQUIRED",
  "REPLACEMENT_REQUIRED",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

const statusByCode: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  ORGANIZATION_INACTIVE: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PROVIDER_DISABLED: 409,
  PROVIDER_NOT_IMPLEMENTED: 501,
  CONNECTION_INVALID: 409,
  SIGNATURE_INVALID: 401,
  RATE_LIMITED: 429,
  TRANSIENT_PROVIDER_ERROR: 503,
  MANUAL_ACTION_REQUIRED: 409,
  REPLACEMENT_REQUIRED: 409,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string = code, retryable = false) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = statusByCode[code];
    this.retryable = retryable;
  }
}

export function fromDatabaseError(
  error: { message?: string; code?: string },
): AppError {
  const message = error.message ?? "";
  const stableCode = errorCodes.find((code) => message.includes(code));
  if (stableCode) {
    return new AppError(
      stableCode,
      stableCode,
      stableCode === "TRANSIENT_PROVIDER_ERROR",
    );
  }
  if (error.code === "PGRST116") return new AppError("NOT_FOUND");
  return new AppError("VALIDATION_ERROR", "Command could not be completed.");
}
