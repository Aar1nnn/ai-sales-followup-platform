import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  validateAuthenticatedManualLeadInput,
  validateLeadIntake,
} from "../_shared/contracts.ts";
import { hmacSha256, verifyHmac } from "../_shared/crypto.ts";
import { channelProvider } from "../_shared/providers/index.ts";
import { validateSourceConnectionConfiguration } from "../_shared/source-config.ts";
import { assuranceLevelFromValidatedJwt } from "../_shared/jwt.ts";
import { parseMemberInvitation } from "../_shared/member-invite.ts";
import { parseFeishuMemberIdentity } from "../_shared/providers/feishu.ts";
import { endpoint } from "../_shared/http.ts";

Deno.test("CORS preflight allows Supabase browser client headers", async () => {
  const response = await endpoint(
    new Request("http://localhost/functions/v1/lead-intake/manual", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    }),
    async () => new Response(null, { status: 500 }),
  );
  const allowedHeaders = new Set(
    (response.headers.get("access-control-allow-headers") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase()),
  );

  assertEquals(response.status, 204);
  assertEquals(allowedHeaders.has("authorization"), true);
  assertEquals(allowedHeaders.has("apikey"), true);
  assertEquals(allowedHeaders.has("content-type"), true);
  assertEquals(allowedHeaders.has("x-client-info"), true);
  assertEquals(allowedHeaders.has("x-retry-count"), true);
});

Deno.test("LeadIntakeV1 enforces organization and connection", () => {
  const value = {
    schema_version: "1.0" as const,
    organization_id: "org-a",
    source: "generic_webhook",
    source_connection_id: "connection-a",
    source_event_id: "event-1",
    received_at: new Date(0).toISOString(),
    contact: {
      name: "客户",
      phone: null,
      email: null,
      wechat: null,
      company: null,
    },
    lead: { need: null, budget: null, urgency: null, notes: null },
    tracking: {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      landing_page: null,
      referrer: null,
    },
    consent: {},
    metadata: {},
  };
  assertEquals(validateLeadIntake(value, "org-a", "connection-a"), value);
});

Deno.test("authenticated manual intake requires organization, need and contact method", () => {
  const value = {
    organization_id: "aaaaaaaa-0000-4000-8000-000000000001",
    source_event_id: "manual-event-0001",
    contact: {
      name: "陈思远",
      phone: "00000000000",
      email: "chen.siyuan@example.com",
      company: "苏州云衡智能科技有限公司",
    },
    lead: { need: "部署 AI 客户跟进系统", budget: 100000 },
    tracking: {},
    consent: { contact_permission: true },
    metadata: {},
  };
  assertEquals(
    validateAuthenticatedManualLeadInput(value),
    value.organization_id,
  );
  assertThrows(() =>
    validateAuthenticatedManualLeadInput({
      ...value,
      contact: { name: "陈思远" },
    })
  );
  assertThrows(() =>
    validateAuthenticatedManualLeadInput({
      ...value,
      lead: { need: "" },
    })
  );
});

Deno.test("raw body HMAC accepts exact signature and rejects changed body", async () => {
  const body = new TextEncoder().encode('{"id":"1"}');
  const signature = await hmacSha256("test-secret", body);
  await verifyHmac("test-secret", body, signature.hex);
  await assertRejects(() =>
    verifyHmac(
      "test-secret",
      new TextEncoder().encode('{"id":"2"}'),
      signature.hex,
    )
  );
});

Deno.test("disabled providers fail closed", async () => {
  const provider = channelProvider("email");
  await assertRejects(() =>
    provider.validateConnection({
      connection: {
        id: "x",
        organization_id: "o",
        provider: "email",
        status: "disabled",
        secret_ref: null,
        public_config: {},
      },
      secret: null,
    })
  );
});

Deno.test("source connection credentials fail closed by provider", () => {
  const configuration = validateSourceConnectionConfiguration({
    provider: "generic_webhook",
    name: "官网 Webhook",
    credentials: { hmac_secret: "test-only-hmac" },
    mapping: { paths: { "contact.name": "customer.name" } },
    settings: { verified_identity_fields: ["email"] },
    rate_limit_per_minute: 30,
    max_payload_bytes: 65_536,
  });
  assertEquals(configuration.provider, "generic_webhook");
  assertEquals(configuration.rateLimitPerMinute, 30);
  assertEquals(JSON.parse(configuration.secret).hmac_secret, "test-only-hmac");
});

Deno.test("tally source requires form id and HMAC", () => {
  assertThrows(() =>
    validateSourceConnectionConfiguration({
      provider: "tally",
      name: "Tally",
      credentials: { token: "wrong-kind" },
      mapping: {},
      settings: {},
    })
  );
});

Deno.test("validated JWT AAL parser accepts only known assurance levels", () => {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-")
      .replace(/\//g, "_");
  const token = `${encode({ alg: "none" })}.${encode({ aal: "aal2" })}.test`;
  const unknown = `${encode({ alg: "none" })}.${encode({ aal: "aal3" })}.test`;
  assertEquals(assuranceLevelFromValidatedJwt(token), "aal2");
  assertEquals(assuranceLevelFromValidatedJwt(unknown), null);
  assertEquals(assuranceLevelFromValidatedJwt("not-a-jwt"), null);
});

Deno.test("member invitation normalizes a valid admin request", () => {
  const input = parseMemberInvitation({
    organization_id: "org-a",
    email: " Sales@Example.com ",
    display_name: " 销售一号 ",
    role: "sales",
    idempotency_key: "invite-request-0001",
  });
  assertEquals(input.email, "sales@example.com");
  assertEquals(input.displayName, "销售一号");
  assertEquals(input.acceptsAssignments, true);
});

Deno.test("Feishu member identity rejects inactive users", () => {
  assertThrows(() =>
    parseFeishuMemberIdentity({
      data: { user: { open_id: "ou_test", status: { is_resigned: true } } },
    }, "ou_test")
  );
  assertEquals(
    parseFeishuMemberIdentity({
      data: {
        user: {
          open_id: "ou_test",
          user_id: "u_test",
          name: "销售一号",
          status: { is_activated: true, is_frozen: false, is_resigned: false },
        },
      },
    }, "ou_test").user_id,
    "u_test",
  );
});
