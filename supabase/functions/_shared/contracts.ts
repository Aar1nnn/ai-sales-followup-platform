import { AppError } from "./errors.ts";

export interface CommandEnvelope {
  command_id: string;
  idempotency_key: string;
  command_name: string;
  organization_id: string;
  actor_user_id: string;
  target_type: string;
  target_id: string | null;
  expected_version: number | null;
  source: "crm" | "feishu" | "n8n" | "system";
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface LeadIntakeV1 {
  schema_version: "1.0";
  organization_id: string;
  source: string;
  source_connection_id: string;
  source_event_id: string;
  received_at: string;
  contact: {
    name: string;
    phone: string | null;
    email: string | null;
    wechat: string | null;
    company: string | null;
  };
  lead: {
    need: string | null;
    budget: number | null;
    urgency: string | null;
    notes: string | null;
  };
  tracking: {
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    landing_page: string | null;
    referrer: string | null;
  };
  consent: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const databaseUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR", `${field} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  field: string,
  maximum: number,
  required = false,
): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new AppError("VALIDATION_ERROR", `${field} is required.`);
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", `${field} is invalid.`);
  }
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum) {
    throw new AppError("VALIDATION_ERROR", `${field} is invalid.`);
  }
  return normalized || null;
}

function text(value: unknown, field: string, required = true): string {
  if (typeof value !== "string" || (required && value.trim() === "")) {
    throw new AppError("VALIDATION_ERROR", `${field} is invalid.`);
  }
  return value.trim();
}

export function parseCommandEnvelope(
  value: Record<string, unknown>,
): CommandEnvelope {
  const payload = value.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("VALIDATION_ERROR", "payload is invalid.");
  }
  const organizationId = text(value.organization_id, "organization_id");
  const commandId = text(value.command_id, "command_id");
  const actorUserId = text(value.actor_user_id, "actor_user_id");
  if (
    !uuidPattern.test(organizationId) || !uuidPattern.test(commandId) ||
    !uuidPattern.test(actorUserId)
  ) throw new AppError("VALIDATION_ERROR");
  const expectedVersion = value.expected_version == null
    ? null
    : Number(value.expected_version);
  if (
    expectedVersion !== null &&
    (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
  ) throw new AppError("VALIDATION_ERROR");
  const targetId = value.target_id == null || value.target_id === ""
    ? null
    : text(value.target_id, "target_id");
  if (targetId && !uuidPattern.test(targetId)) {
    throw new AppError("VALIDATION_ERROR");
  }
  return {
    command_id: commandId,
    idempotency_key: text(value.idempotency_key, "idempotency_key"),
    command_name: text(value.command_name, "command_name"),
    organization_id: organizationId,
    actor_user_id: actorUserId,
    target_type: text(value.target_type, "target_type"),
    target_id: targetId,
    expected_version: expectedVersion,
    source: text(value.source, "source") as CommandEnvelope["source"],
    occurred_at: text(value.occurred_at, "occurred_at"),
    payload: payload as Record<string, unknown>,
  };
}

export function validateLeadIntake(
  value: LeadIntakeV1,
  organizationId: string,
  connectionId: string,
): LeadIntakeV1 {
  if (
    value.schema_version !== "1.0" ||
    value.organization_id !== organizationId ||
    value.source_connection_id !== connectionId
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  if (!value.source_event_id || !value.contact?.name?.trim()) {
    throw new AppError("VALIDATION_ERROR");
  }
  if (
    value.lead.budget !== null &&
    (!Number.isFinite(value.lead.budget) || value.lead.budget < 0)
  ) throw new AppError("VALIDATION_ERROR");
  return value;
}

export function validateAuthenticatedManualLeadInput(
  value: Record<string, unknown>,
): string {
  const organizationId = boundedText(
    value.organization_id,
    "organization_id",
    36,
    true,
  );
  if (!organizationId || !databaseUuidPattern.test(organizationId)) {
    throw new AppError("VALIDATION_ERROR", "organization_id is invalid.");
  }
  const sourceEventId = boundedText(
    value.source_event_id,
    "source_event_id",
    120,
    true,
  );
  if (!sourceEventId || !/^[A-Za-z0-9._:-]{8,120}$/.test(sourceEventId)) {
    throw new AppError("VALIDATION_ERROR", "source_event_id is invalid.");
  }

  const contact = objectValue(value.contact, "contact");
  boundedText(contact.name, "contact.name", 120, true);
  const phone = boundedText(contact.phone, "contact.phone", 40);
  const email = boundedText(contact.email, "contact.email", 320);
  const wechat = boundedText(contact.wechat, "contact.wechat", 120);
  boundedText(contact.company, "contact.company", 200);
  if (!phone && !email && !wechat) {
    throw new AppError(
      "VALIDATION_ERROR",
      "At least one contact method is required.",
    );
  }
  if (phone && !/^[0-9+()\-\s]{6,40}$/.test(phone)) {
    throw new AppError("VALIDATION_ERROR", "contact.phone is invalid.");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("VALIDATION_ERROR", "contact.email is invalid.");
  }

  const lead = objectValue(value.lead, "lead");
  boundedText(lead.need, "lead.need", 2000, true);
  boundedText(lead.urgency, "lead.urgency", 120);
  boundedText(lead.notes, "lead.notes", 5000);
  if (lead.budget !== null && lead.budget !== undefined && lead.budget !== "") {
    const budget = Number(lead.budget);
    if (!Number.isFinite(budget) || budget < 0 || budget > 1_000_000_000_000) {
      throw new AppError("VALIDATION_ERROR", "lead.budget is invalid.");
    }
  }

  const consent = objectValue(value.consent ?? {}, "consent");
  if (consent.contact_permission !== true) {
    throw new AppError(
      "VALIDATION_ERROR",
      "contact permission confirmation is required.",
    );
  }
  objectValue(value.tracking ?? {}, "tracking");
  objectValue(value.metadata ?? {}, "metadata");
  return organizationId;
}

export function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
