import { describe, it, expect } from "vitest";
import { MANUAL_TOLERANCE_SCHEMA } from "@/lib/risk/schema";

describe("MANUAL_TOLERANCE_SCHEMA", () => {
  it("requires a valid rung and non-empty reasoning", () => {
    expect(MANUAL_TOLERANCE_SCHEMA.safeParse({ level: "moderate", reason: "Client call" }).success).toBe(true);
    expect(MANUAL_TOLERANCE_SCHEMA.safeParse({ level: "moderate", reason: "" }).success).toBe(false);
    expect(MANUAL_TOLERANCE_SCHEMA.safeParse({ level: "bogus", reason: "x" }).success).toBe(false);
  });
});
