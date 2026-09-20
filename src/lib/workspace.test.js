import { describe, expect, it } from "vitest";
import {
  activityLabel,
  aiModelLabel,
  aiProviderLabel,
  buildWorkQueue,
  dueLabel,
  filterWorkQueue,
  formatBudget,
  priorityLabel,
  sourceLabel,
  statusLabel,
  urgencyLabel,
} from "./workspace";

const now = new Date("2026-08-06T10:00:00+08:00");

describe("sales workspace model", () => {
  it("puts overdue work before unassigned leads and drafts", () => {
    const items = buildWorkQueue({
      now,
      tasks: [{ id: "task-1", title: "回访客户", status: "open", due_at: "2026-08-06T08:00:00+08:00", lead_id: "lead-1", contacts: { full_name: "王女士" } }],
      leads: [{ id: "lead-2", status: "new", owner_member_id: null, need: "AI 落地", contacts: { full_name: "李先生" }, lead_scores: [] }],
      drafts: [{ id: "draft-1", status: "pending_approval", content: "您好", contacts: { full_name: "赵总" } }],
    });
    expect(items.map((item) => item.kind)).toEqual(["task", "unassigned", "draft"]);
    expect(items[0].href).toContain("/leads/lead-1");
  });

  it("only includes open tasks due today or overdue", () => {
    const items = buildWorkQueue({
      now,
      tasks: [
        { id: "today", status: "open", due_at: "2026-08-06T17:00:00+08:00" },
        { id: "future", status: "open", due_at: "2026-08-08T09:00:00+08:00" },
        { id: "done", status: "completed", due_at: "2026-08-06T09:00:00+08:00" },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["task:today"]);
  });

  it("filters the unified queue without changing source items", () => {
    const items = [{ kind: "task" }, { kind: "lead" }, { kind: "unassigned" }, { kind: "draft" }];
    expect(filterWorkQueue(items, "leads")).toHaveLength(2);
    expect(filterWorkQueue(items, "drafts")).toEqual([{ kind: "draft" }]);
    expect(items).toHaveLength(4);
  });

  it("uses human readable status and due labels", () => {
    expect(statusLabel("pending_approval")).toBe("待审批");
    expect(statusLabel("unknown_internal_status")).toBe("状态待确认");
    expect(dueLabel("2026-08-06T09:00:00+08:00", now)).toContain("逾期");
  });

  it("translates lead detail enums without exposing internal values", () => {
    expect(sourceLabel("internal_manual")).toBe("系统手工录入");
    expect(urgencyLabel("high")).toBe("高（30 天内）");
    expect(priorityLabel("medium_high")).toBe("较高优先级");
    expect(activityLabel("accept_lead", "Accept Lead")).toBe("接受线索");
    expect(activityLabel("unknown_command", "Unknown Command")).toBe("系统操作记录");
    expect(aiProviderLabel("aliyun_bailian")).toBe("阿里云百炼");
    expect(aiProviderLabel("deepseek")).toBe("深度求索（DeepSeek）");
    expect(aiModelLabel("qwen3.7-plus")).toBe("通义千问模型");
    expect(formatBudget(100000, "CNY")).toBe("人民币 100,000");
    expect(formatBudget(null, "CNY")).toBe("尚未提供");
  });
});
