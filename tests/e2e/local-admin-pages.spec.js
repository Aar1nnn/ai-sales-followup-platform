import { expect, test } from "@playwright/test";

test.describe("local authenticated admin pages", () => {
  test.skip(
    !globalThis.process?.env.RUN_LOCAL_AUTH_TESTS,
    "requires seeded local Supabase",
  );

  test("Owner can render member management and operations data", async ({ page }) => {
    await page.goto("/login?returnTo=%2Fsettings%2Fmembers");
    await page.locator('input[type="email"]').fill("owner.a@example.test");
    await page.locator('input[type="password"]').fill("LocalOnly123!");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/settings\/members$/);
    await expect(page.getByRole("heading", { name: "成员、角色与飞书身份" })).toBeVisible();
    await expect(page.locator(".member-card").first()).toBeVisible();

    await page.goto("/operations");
    await expect(page.getByRole("heading", { name: "自动化运行与异常" })).toBeVisible();
    await expect(page.locator(".operations-metrics")).toBeVisible();
  });

  test("Owner can use the P0 sales operating workspace without dead ends", async ({ page }) => {
    await page.goto("/login?returnTo=%2Fdashboard");
    await page.locator('input[type="email"]').fill("owner.a@example.test");
    await page.locator('input[type="password"]').fill("LocalOnly123!");
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Owner A，今天从这里开始" })).toBeVisible();
    await expect(page.getByText("确认 AI 落地范围").first()).toBeVisible();
    await expect(page.locator(".sidebar").getByRole("link", { name: /^待处理/ })).toBeVisible();
    await page.screenshot({ fullPage: true, path: "test-results/p0-dashboard.png" });

    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "待处理中心" })).toBeVisible();
    await expect(page.getByText("销售流程自动化")).toBeVisible();
    await expect(page.getByText("您好，我们已经整理好 AI 营销系统的首轮落地建议")).toBeVisible();

    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "把系统配置到可以真正工作" })).toBeVisible();
    await expect(page.getByText("n8n 自动化")).toBeVisible();
    await page.screenshot({ fullPage: true, path: "test-results/p0-setup.png" });

    await page.getByRole("link", { name: "开始无飞书演示" }).click();
    await expect(page).toHaveURL(/\/leads\/new\?demo=1$/);
    await expect(page.getByLabel("客户姓名")).toHaveValue("示例联系人");
    await expect(page.getByLabel("邮箱")).toHaveValue("lead@example.test");

    await page.goto("/leads/aa200000-0000-0000-0000-000000000001");
    await expect(page.getByRole("heading", { name: "示例客户 A1", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "完成本次客户联系" })).toBeVisible();
    await expect(page.getByRole("button", { name: "已完成联系，记录结果" })).toBeVisible();
    await page.screenshot({ fullPage: true, path: "test-results/p0-lead-workspace.png" });

    await page.goto("/tasks/aa700000-0000-0000-0000-000000000001");
    await expect(page.getByRole("heading", { name: "确认 AI 落地范围" })).toBeVisible();
    await expect(page.getByRole("link", { name: "进入线索工作台完成跟进" })).toBeVisible();

    await page.goto("/message-drafts/aa600000-0000-0000-0000-000000000001/review");
    await expect(page.getByRole("heading", { name: "示例客户 A1", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "批准并进入外部联系" })).toBeVisible();

    await page.goto("/opportunities/aa400000-0000-0000-0000-000000000001");
    await expect(page.getByRole("heading", { name: "示例客户 A3 - 企业知识库与销售协同" })).toBeVisible();
    await expect(page.getByRole("button", { name: "标记为已成交" })).toBeVisible();
  });

  test("Owner can create a manual lead and land in its workspace", async ({ page }) => {
    await page.goto("/login?returnTo=%2Fdashboard");
    await page.locator('input[type="email"]').fill("owner.a@example.test");
    await page.locator('input[type="password"]').fill("LocalOnly123!");
    await page.locator('button[type="submit"]').click();

    await expect(page.getByRole("link", { name: "+ 新建线索" })).toBeVisible();
    await page.getByRole("link", { name: "+ 新建线索" }).click();
    await expect(page).toHaveURL(/\/leads\/new$/);
    await expect(page.getByRole("heading", { name: "新建线索" })).toBeVisible();
    await page.getByRole("button", { name: "填入演示客户" }).click();
    await expect(page.getByLabel("客户姓名")).toHaveValue("示例联系人");
    await page.screenshot({ fullPage: true, path: "test-results/manual-lead-form.png" });
    await page.getByRole("button", { name: "创建并进入线索工作台" }).click();

    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "示例联系人", exact: true })).toBeVisible();
    await expect(page.getByText("线索已经创建。请继续确认负责人")).toBeVisible();
    await expect(page.getByText(/公司有 18 名销售，线索来自官网、展会和转介绍/)).toBeVisible();
  });

  test("Sales can see assigned work and cannot enter Owner setup", async ({ page }) => {
    await page.goto("/login?returnTo=%2Finbox");
    await page.locator('input[type="email"]').fill("sales.a1@example.test");
    await page.locator('input[type="password"]').fill("LocalOnly123!");
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByRole("heading", { name: "待处理中心" })).toBeVisible();
    await expect(page.getByText("示例客户 A1").first()).toBeVisible();
    await expect(page.getByText("确认 AI 落地范围").first()).toBeVisible();

    await page.goto("/leads/aa200000-0000-0000-0000-000000000001");
    await expect(page.getByRole("heading", { name: "示例客户 A1", exact: true })).toBeVisible();

    await page.goto("/setup");
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test("manual intake rejects requests without a Supabase login", async ({ request }) => {
    const response = await request.post("http://127.0.0.1:54321/functions/v1/lead-intake/manual", {
      data: {
        organization_id: "aaaaaaaa-0000-0000-0000-000000000001",
        source_event_id: "manual-unauthenticated-test-0001",
        contact: { name: "未登录测试", phone: "18800001111" },
        lead: { need: "必须被拒绝" },
        consent: { contact_permission: true },
      },
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("P0 workspace stays usable at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login?returnTo=%2Fdashboard");
    await page.locator('input[type="email"]').fill("owner.a@example.test");
    await page.locator('input[type="password"]').fill("LocalOnly123!");
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Owner A，今天从这里开始" })).toBeVisible();
    const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(viewportFits).toBe(true);
    await page.screenshot({ fullPage: true, path: "test-results/p0-dashboard-mobile.png" });

    await page.goto("/leads/new");
    await expect(page.getByRole("heading", { name: "新建线索" })).toBeVisible();
    await page.getByRole("button", { name: "填入演示客户" }).click();
    const manualLeadViewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(manualLeadViewportFits).toBe(true);
  });
});
