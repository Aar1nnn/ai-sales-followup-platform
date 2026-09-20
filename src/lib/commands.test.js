import { describe, expect, it, vi } from "vitest";
import { createCommandEnvelope } from "./commands";

describe("createCommandEnvelope", () => {
  it("创建固定公开契约并保留 expected version", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("30000000-0000-4000-a000-000000000001").mockReturnValueOnce("30000000-0000-4000-a000-000000000002");
    const envelope = createCommandEnvelope({ commandName: "accept_lead", organizationId: "aaaaaaaa-0000-0000-0000-000000000001", actorUserId: "10000000-0000-0000-0000-000000000004", targetType: "lead", targetId: "aa200000-0000-0000-0000-000000000001", expectedVersion: 3 });
    expect(envelope).toMatchObject({ command_id: "30000000-0000-4000-a000-000000000002", idempotency_key: "30000000-0000-4000-a000-000000000001", command_name: "accept_lead", expected_version: 3, source: "crm" });
    expect(envelope.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
