import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildManualLeadPayload, createManualLead, demoManualLead, validateManualLeadForm } from "./manualLead";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

describe("manual lead intake", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("builds the authenticated internal manual intake payload", () => {
    const payload = buildManualLeadPayload(
      demoManualLead,
      "aaaaaaaa-0000-4000-8000-000000000001",
      "manual-event-0001",
    );
    expect(payload.contact.name).toBe("示例联系人");
    expect(payload.contact.phone).toBeNull();
    expect(payload.contact.email).toBe("lead@example.test");
    expect(payload.lead.budget).toBe(120000);
    expect(payload.tracking.utm_source).toBe("crm_manual");
    expect(payload.consent.contact_permission).toBe(true);
  });

  it("requires a contact method and lawful contact basis", () => {
    expect(validateManualLeadForm({
      ...demoManualLead,
      phone: "",
      email: "",
      wechat: "",
    })).toBe("电话、邮箱或微信至少填写一项。");
    expect(validateManualLeadForm({
      ...demoManualLead,
      contactPermission: false,
    })).toBe("请确认企业拥有联系该客户的合法依据。");
  });

  it("turns the remote missing route response into actionable Chinese", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { error: { code: "NOT_FOUND", message: "NOT_FOUND" } },
      },
    });

    await expect(createManualLead({})).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "当前服务器还没有启用手工创建线索。请使用本地验收环境，或请管理员完成系统升级。",
    });
  });
});
