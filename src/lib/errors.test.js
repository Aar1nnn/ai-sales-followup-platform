import { describe, expect, it } from "vitest";
import { functionFailureDetails, toUserMessage } from "./errors";

describe("friendly frontend errors", () => {
  it("reads a plain object context without calling a missing json function", async () => {
    const result = await functionFailureDetails({
      message: "Relay Error invoking the Edge Function",
      context: { error: { code: "NOT_FOUND", message: "Function not found" } },
    });

    expect(result.code).toBe("NOT_FOUND");
    expect(result.message).toBe("找不到相关记录。它可能已被删除，或者你没有查看权限。");
  });

  it("reads an HTTP Response context", async () => {
    const context = new Response(JSON.stringify({
      error: { code: "VERSION_CONFLICT", message: "Old version" },
    }), { headers: { "content-type": "application/json" }, status: 409 });

    const result = await functionFailureDetails({ context });
    expect(result.code).toBe("VERSION_CONFLICT");
    expect(result.message).toContain("刷新页面");
  });

  it("reads a nested response context", async () => {
    const response = new Response(JSON.stringify({
      error: { code: "FORBIDDEN", message: "Permission denied" },
    }), { headers: { "content-type": "application/json" }, status: 403 });

    const result = await functionFailureDetails({ context: { response } });
    expect(result.message).toBe("当前账号没有权限执行这项操作。");
  });

  it("translates common Supabase Auth messages", () => {
    expect(toUserMessage(
      new Error("Invalid login credentials"),
      "登录失败，请稍后重试。",
    )).toBe("邮箱或密码不正确，请检查后重试。");
    expect(toUserMessage(
      new Error("Signups not allowed for this instance"),
      "注册失败，请稍后重试。",
    )).toBe("当前系统暂未开放自行注册，请联系企业管理员发送邀请。");
    expect(toUserMessage(
      new Error("Email rate limit exceeded"),
      "注册失败，请稍后重试。",
    )).toBe("验证邮件发送额度暂时用完了，请稍后再试；如果持续出现，请联系管理员配置企业邮件服务。");
  });

  it("keeps specific Chinese server guidance", () => {
    expect(toUserMessage({
      code: "VALIDATION_ERROR",
      message: "请填写客户需求。",
    })).toBe("请填写客户需求。");
  });

  it("uses a safe fallback instead of exposing an unknown English message", () => {
    expect(toUserMessage(
      new Error("Unexpected lower-level adapter failure"),
      "线索没有创建成功，请稍后再试。",
    )).toBe("线索没有创建成功，请稍后再试。");
  });
});
