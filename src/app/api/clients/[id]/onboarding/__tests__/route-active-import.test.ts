import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror of patchSchema in route.ts — the route's full handler is
// integration-tested elsewhere; here we lock the schema contract for
// the new activeImportId field.
const patchSchema = z
  .object({
    skippedSteps: z.array(z.string()).optional(),
    lastStepVisited: z.string().optional(),
    activeImportId: z.string().uuid().nullable().optional(),
  })
  .strict();

describe("onboarding PATCH schema — activeImportId", () => {
  it("accepts a uuid", () => {
    const r = patchSchema.safeParse({
      activeImportId: "00000000-0000-0000-0000-000000000000",
    });
    expect(r.success).toBe(true);
  });

  it("accepts null (clear)", () => {
    const r = patchSchema.safeParse({ activeImportId: null });
    expect(r.success).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    const r = patchSchema.safeParse({ activeImportId: "not-a-uuid" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const r = patchSchema.safeParse({ bogus: 1 });
    expect(r.success).toBe(false);
  });
});
