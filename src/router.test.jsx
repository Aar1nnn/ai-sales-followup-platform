import { describe, expect, it } from "vitest";
import { router } from "./router";
import { businessNavigation } from "./lib/navigation";

function paths(routes) {
  return routes.flatMap((route) => [route.path, ...(route.children ? paths(route.children) : [])]).filter(Boolean);
}

describe("router contract", () => {
  it("注册全部标准产品深链", () => {
    expect(paths(router.routes)).toEqual(expect.arrayContaining([
      "/login", "/set-password", "/dashboard", "/inbox", "/setup", "/contacts", "/contacts/:contactId", "/leads", "/leads/new", "/leads/:leadId",
      "/opportunities", "/opportunities/:opportunityId", "/tasks", "/tasks/:taskId",
      "/message-drafts/:draftId", "/message-drafts/:draftId/review", "/reports", "/settings",
      "/operations",
    ]));
  });

  it("在业务主导航中直接提供线索和任务入口", () => {
    expect(businessNavigation.map((item) => item.to)).toEqual([
      "/contacts",
      "/leads",
      "/tasks",
      "/opportunities",
      "/reports",
    ]);
  });
});
