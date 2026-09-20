import { describe, expect, it } from "vitest";
import { sourceReadiness } from "./setupReadiness";

const source = { id: "source-1", name: "CRM 手工录入", status: "active" };

describe("setup source readiness", () => {
  it("does not mark a configured source ready without a successful intake", () => {
    expect(sourceReadiness([source], []).ready).toBe(false);
  });

  it("requires a processed event with a created lead for the active source", () => {
    expect(sourceReadiness([source], [{
      source_connection_id: source.id,
      status: "accepted",
      lead_id: null,
    }]).ready).toBe(false);

    expect(sourceReadiness([source], [{
      source_connection_id: source.id,
      status: "processed",
      lead_id: "lead-1",
      processed_at: "2026-08-06T06:00:00Z",
    }])).toMatchObject({
      ready: true,
      verifiedSource: source,
      successfulEvent: { lead_id: "lead-1" },
    });
  });

  it("does not use a successful event from an inactive source", () => {
    expect(sourceReadiness(
      [{ ...source, status: "disabled" }],
      [{ source_connection_id: source.id, status: "processed", lead_id: "lead-1" }],
    ).ready).toBe(false);
  });
});
