import { type LeadIntakeV1, nullableText } from "../contracts.ts";
import { AppError } from "../errors.ts";
import { verifyHmac } from "../crypto.ts";
import { secretValue, sourceEventId } from "./common.ts";
import type { SourceAdapter } from "./types.ts";

interface TallyField {
  key?: string;
  label?: string;
  value?: unknown;
}

function asFields(payload: Record<string, unknown>): TallyField[] {
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const fields = (data as Record<string, unknown>).fields;
  return Array.isArray(fields)
    ? fields.filter((field): field is TallyField =>
      Boolean(field && typeof field === "object")
    )
    : [];
}

function fieldValue(fields: TallyField[], selector: unknown): unknown {
  if (typeof selector !== "string") return undefined;
  return fields.find((field) =>
    field.key === selector || field.label === selector
  )?.value;
}

export const tallyAdapter: SourceAdapter = {
  async verify(context) {
    const signature = context.request.headers.get("x-tally-signature") ??
      context.request.headers.get("tally-signature");
    const secret = secretValue(context.secret, "hmac_secret");
    if (!secret) throw new AppError("CONNECTION_INVALID");
    await verifyHmac(secret, context.rawBody, signature);
  },
  normalize(context): LeadIntakeV1 {
    const data = context.payload.data as Record<string, unknown> | undefined;
    const formId = nullableText(data?.formId ?? data?.form_id);
    if (
      context.connection.external_source_id &&
      formId !== context.connection.external_source_id
    ) throw new AppError("VALIDATION_ERROR");
    const fields = asFields(context.payload);
    const map = context.connection.mapping as Record<string, unknown>;
    const get = (path: string) => fieldValue(fields, map[path]);
    const budgetValue = get("lead.budget");
    const budget =
      budgetValue === undefined || budgetValue === null || budgetValue === ""
        ? null
        : Number(budgetValue);
    return {
      schema_version: "1.0",
      organization_id: context.connection.organization_id,
      source: "tally",
      source_connection_id: context.connection.id,
      source_event_id: sourceEventId(
        context.payload,
        nullableText(data?.submissionId ?? data?.submission_id) ?? undefined,
      ),
      received_at: context.receivedAt,
      contact: {
        name: nullableText(get("contact.name")) ?? "未命名联系人",
        phone: nullableText(get("contact.phone")),
        email: nullableText(get("contact.email")),
        wechat: nullableText(get("contact.wechat")),
        company: nullableText(get("contact.company")),
      },
      lead: {
        need: nullableText(get("lead.need")),
        budget,
        urgency: nullableText(get("lead.urgency")),
        notes: nullableText(get("lead.notes")),
      },
      tracking: {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        landing_page: null,
        referrer: null,
      },
      consent: {},
      metadata: { tally_form_id: formId },
    };
  },
};
