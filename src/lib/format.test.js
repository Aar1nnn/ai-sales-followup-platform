import { describe, expect, it } from "vitest";
import { formatDate, toLocalDateTimeInputValue } from "./format";

describe("date formatting", () => {
  it("formats datetime-local minimum in the browser local timezone", () => {
    const source = new Date();
    const localValue = toLocalDateTimeInputValue(source);
    expect(localValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(Math.abs(new Date(localValue).getTime() - source.getTime())).toBeLessThan(60_000);
  });

  it("returns safe placeholders for invalid values", () => {
    expect(toLocalDateTimeInputValue("invalid")).toBe("");
    expect(formatDate("invalid")).toBe("—");
  });
});
