import { describe, expect, it } from "vitest";
import { formatCreatedAt } from "./format";

describe("formatCreatedAt", () => {
  it("formats UTC timestamps without shifting the hour", () => {
    expect(formatCreatedAt("2026-01-15T12:00:00Z")).toMatch(/15 Jan 2026/);
    expect(formatCreatedAt("2026-01-15T12:00:00Z")).toMatch(/12:00/);
    expect(formatCreatedAt("2026-01-15T12:00:00Z")).toMatch(/UTC$/);
  });

  it("returns an unparseable value unchanged", () => {
    expect(formatCreatedAt("not-a-date")).toBe("not-a-date");
  });
});
