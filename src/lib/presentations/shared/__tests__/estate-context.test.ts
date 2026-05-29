import { describe, it, expect } from "vitest";
import { resolveAsOfYear } from "../estate-context";
import type { ProjectionResult } from "@/engine/projection";

function fakeProjection(years: number[]): ProjectionResult {
  return { years: years.map((year) => ({ year })) } as unknown as ProjectionResult;
}

describe("resolveAsOfYear", () => {
  const projection = fakeProjection([2026, 2027, 2028]);

  it("maps today/split to the plan start year", () => {
    expect(resolveAsOfYear({ kind: "today" }, projection)).toBe(2026);
    expect(resolveAsOfYear({ kind: "split" }, projection)).toBe(2026);
  });

  it("passes an explicit year through", () => {
    expect(resolveAsOfYear({ kind: "year", year: 2031 }, projection)).toBe(2031);
  });

  it("falls back to the current year when projection has no years", () => {
    const empty = fakeProjection([]);
    const y = resolveAsOfYear({ kind: "today" }, empty);
    expect(y).toBe(new Date().getFullYear());
  });
});
