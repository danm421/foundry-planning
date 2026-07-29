import { describe, it, expect } from "vitest";
import { ENVIRONMENT_SCHEMA } from "@/lib/risk/schema";

describe("ENVIRONMENT_SCHEMA", () => {
  it("accepts a bounded adjustment with reasoning", () => {
    expect(ENVIRONMENT_SCHEMA.safeParse({ adjustment: -12, reason: "Layoff risk" }).success).toBe(true);
  });

  it("rejects an adjustment outside -25..25", () => {
    expect(ENVIRONMENT_SCHEMA.safeParse({ adjustment: -26, reason: "x" }).success).toBe(false);
    expect(ENVIRONMENT_SCHEMA.safeParse({ adjustment: 26, reason: "x" }).success).toBe(false);
  });

  it("rejects a non-zero adjustment with blank reasoning", () => {
    expect(ENVIRONMENT_SCHEMA.safeParse({ adjustment: -10, reason: "" }).success).toBe(false);
    expect(ENVIRONMENT_SCHEMA.safeParse({ adjustment: -10, reason: "   " }).success).toBe(false);
    expect(ENVIRONMENT_SCHEMA.safeParse({ adjustment: -10 }).success).toBe(false);
  });

  it("allows clearing back to zero without reasoning", () => {
    expect(ENVIRONMENT_SCHEMA.safeParse({ adjustment: 0 }).success).toBe(true);
  });
});
