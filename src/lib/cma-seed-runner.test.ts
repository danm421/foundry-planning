import { describe, it, expect } from "vitest";
import { db } from "@/db";
import { cmaSets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { seedCmaForFirm } from "@/lib/cma-seed-runner";

describe("seedCmaForFirm also seeds CMA sets", () => {
  it("creates 3 sets", async () => {
    const firmId = "test-firm-seed-runner-sets";
    await seedCmaForFirm(firmId);
    const sets = await db.select().from(cmaSets).where(eq(cmaSets.firmId, firmId));
    expect(sets.length).toBe(3);
  });
});
