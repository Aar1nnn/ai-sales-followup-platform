import { expect, test } from "@playwright/test";

test("登录页可直接刷新", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录 CRM" })).toBeVisible();
});

test("未登录深链保留安全 returnTo", async ({ page }) => {
  await page.goto("/leads/aa200000-0000-0000-0000-000000000001?source=feishu");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  const url = new URL(page.url());
  expect(decodeURIComponent(url.searchParams.get("returnTo"))).toBe("/leads/aa200000-0000-0000-0000-000000000001?source=feishu");
});

test("草稿审核正式深链保留 returnTo", async ({ page }) => {
  const path = "/message-drafts/aa600000-0000-0000-0000-000000000001/review";
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  const url = new URL(page.url());
  expect(decodeURIComponent(url.searchParams.get("returnTo"))).toBe(path);
});

test("未登录访问运维深链保留安全 returnTo", async ({ page }) => {
  await page.goto("/operations");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  const url = new URL(page.url());
  expect(decodeURIComponent(url.searchParams.get("returnTo"))).toBe("/operations");
});

test("未登录访问待处理和上线中心保留安全 returnTo", async ({ page }) => {
  for (const path of ["/inbox?view=drafts", "/setup", "/leads/new"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    const url = new URL(page.url());
    expect(decodeURIComponent(url.searchParams.get("returnTo"))).toBe(path);
  }
});
