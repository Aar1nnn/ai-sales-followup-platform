import { describe, expect, it } from "vitest";
import { manualDraftStep, terminalOutcomes, validateManualSend } from "./manualFlow";

const valid = { content: "您好，这是实际发送内容", actual_channel: "personal_wechat", outcome: "interested", next_follow_up_at: "2026-08-06T10:00" };

describe("validateManualSend", () => {
  it("要求实际渠道、内容和结果", () => {
    expect(validateManualSend({})).toMatchObject({ content: expect.any(String), actual_channel: expect.any(String), outcome: expect.any(String) });
  });

  it.each(["no_reply", "replied", "interested"])("%s 必须安排下一次跟进", (outcome) => {
    expect(validateManualSend({ ...valid, outcome, next_follow_up_at: "" })).toHaveProperty("next_follow_up_at");
  });

  it.each([...terminalOutcomes])("终止结果 %s 不强制下一次跟进", (outcome) => {
    expect(validateManualSend({ ...valid, outcome, next_follow_up_at: "" })).toEqual({});
  });
});

describe("manualDraftStep", () => {
  it("maps persisted status and explicit external handoff to the five-step flow", () => {
    expect(manualDraftStep("draft")).toBe(1);
    expect(manualDraftStep("pending_approval")).toBe(2);
    expect(manualDraftStep("approved")).toBe(3);
    expect(manualDraftStep("approved", true)).toBe(4);
    expect(manualDraftStep("sent")).toBe(5);
  });
});
