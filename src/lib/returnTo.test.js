import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "./returnTo";

describe("sanitizeReturnTo", () => {
  it("保留站内深链和查询参数", () => {
    expect(sanitizeReturnTo("/leads/123?source=feishu#activity")).toBe("/leads/123?source=feishu#activity");
  });

  it.each(["https://evil.example", "//evil.example/path", "\\evil.example", "javascript:alert(1)", null])("拒绝外部或非法 returnTo: %s", (value) => {
    expect(sanitizeReturnTo(value)).toBe("/dashboard");
  });
});
