// src/lib/portal/__tests__/load-budget-data.test.ts
import { describe, it, expect } from "vitest";
import { currentMonthRange } from "@/lib/portal/load-budget-data";

it("derives inclusive month bounds in UTC", () => {
  expect(currentMonthRange(new Date("2026-06-23T14:00:00Z"))).toEqual({
    from: "2026-06-01",
    to: "2026-06-30",
    month: "2026-06",
  });
});

it("handles February in a leap year", () => {
  expect(currentMonthRange(new Date("2024-02-10T00:00:00Z"))).toEqual({
    from: "2024-02-01",
    to: "2024-02-29",
    month: "2024-02",
  });
});

it("handles December (month rollover)", () => {
  expect(currentMonthRange(new Date("2025-12-31T23:59:00Z"))).toEqual({
    from: "2025-12-01",
    to: "2025-12-31",
    month: "2025-12",
  });
});
