import { type LeadIntakeV1, nullableText } from "../contracts.ts";
import { AppError } from "../errors.ts";
import type { SourceConnection } from "./types.ts";

export function sourceEventId(
  payload: Record<string, unknown>,
  fallback?: string,
): string {
  const candidates = [
    payload.eventId,
    payload.event_id,
    payload.submissionId,
    payload.submission_id,
    payload.id,
    fallback,
  ];
  const found = candidates.find((value) =>
    typeof value === "string" && value.trim()
  );
  if (!found) {
    throw new AppError("VALIDATION_ERROR", "source_event_id is required.");
  }
  return String(found).trim();
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, payload);
}

export function genericLeadIntake(
  connection: SourceConnection,
  payload: Record<string, unknown>,
  receivedAt: string,
): LeadIntakeV1 {
  const configured = connection.mapping.paths;
  const paths =
    configured && typeof configured === "object" && !Array.isArray(configured)
      ? configured as Record<string, string>
      : {};
  const value = (key: string, defaultPath: string): unknown =>
    readPath(payload, paths[key] ?? defaultPath);
  const budgetValue = value("lead.budget", "lead.budget");
  const budget =
    budgetValue === null || budgetValue === undefined || budgetValue === ""
      ? null
      : Number(budgetValue);
  return {
    schema_version: "1.0",
    organization_id: connection.organization_id,
    source: connection.provider,
    source_connection_id: connection.id,
    source_event_id: sourceEventId(
      payload,
      nullableText(value("source_event_id", "source_event_id")) ?? undefined,
    ),
    received_at: receivedAt,
    contact: {
      name: nullableText(value("contact.name", "contact.name")) ??
        "未命名联系人",
      phone: nullableText(value("contact.phone", "contact.phone")),
      email: nullableText(value("contact.email", "contact.email")),
      wechat: nullableText(value("contact.wechat", "contact.wechat")),
      company: nullableText(value("contact.company", "contact.company")),
    },
    lead: {
      need: nullableText(value("lead.need", "lead.need")),
      budget,
      urgency: nullableText(value("lead.urgency", "lead.urgency")),
      notes: nullableText(value("lead.notes", "lead.notes")),
    },
    tracking: {
      utm_source: nullableText(
        value("tracking.utm_source", "tracking.utm_source"),
      ),
      utm_medium: nullableText(
        value("tracking.utm_medium", "tracking.utm_medium"),
      ),
      utm_campaign: nullableText(
        value("tracking.utm_campaign", "tracking.utm_campaign"),
      ),
      landing_page: nullableText(
        value("tracking.landing_page", "tracking.landing_page"),
      ),
      referrer: nullableText(value("tracking.referrer", "tracking.referrer")),
    },
    consent: (value("consent", "consent") as Record<string, unknown>) ?? {},
    metadata: (value("metadata", "metadata") as Record<string, unknown>) ?? {},
  };
}

export function secretValue(secret: string | null, key: string): string | null {
  if (!secret) return null;
  try {
    const parsed = JSON.parse(secret) as Record<string, unknown>;
    return nullableText(parsed[key]);
  } catch {
    return key === "token" || key === "hmac_secret" ? secret : null;
  }
}
