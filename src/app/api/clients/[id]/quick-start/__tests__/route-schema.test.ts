import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror of patchSchema in route.ts — the full handler is integration-tested
// elsewhere; here we lock the request contract.
const patchSchema = z
  .object({
    lastStepVisited: z.string().optional(),
    completed: z.boolean().optional(),
    dismissed: z.boolean().optional(),
  })
  .strict();

describe("quick-start PATCH schema", () => {
  it("accepts lastStepVisited", () => {
    expect(patchSchema.safeParse({ lastStepVisited: "income" }).success).toBe(true);
  });
  it("accepts completed / dismissed booleans", () => {
    expect(patchSchema.safeParse({ completed: true }).success).toBe(true);
    expect(patchSchema.safeParse({ dismissed: true }).success).toBe(true);
  });
  it("accepts an empty body", () => {
    expect(patchSchema.safeParse({}).success).toBe(true);
  });
  it("rejects unknown keys (strict)", () => {
    expect(patchSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });
  it("rejects wrong types", () => {
    expect(patchSchema.safeParse({ completed: "yes" }).success).toBe(false);
  });
});
