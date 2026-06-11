import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import { builtinTemplateDismissals, firms } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  listDismissedSlugs,
  dismissBuiltin,
  restoreBuiltin,
} from "@/lib/presentations/builtin-templates-repo";

const FIRM = "firm_dismiss_test";

async function ensureFirm() {
  await db.insert(firms).values({ firmId: FIRM, displayName: "Test Firm" }).onConflictDoNothing();
}
async function cleanup() {
  await db.delete(builtinTemplateDismissals).where(eq(builtinTemplateDismissals.firmId, FIRM));
}

beforeAll(ensureFirm);
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await db.delete(firms).where(eq(firms.firmId, FIRM));
});

describe("builtin-templates-repo", () => {
  it("dismiss then list returns the slug for that user only", async () => {
    await dismissBuiltin(FIRM, "user_a", "foundation-plan");
    expect([...(await listDismissedSlugs(FIRM, "user_a"))]).toEqual(["foundation-plan"]);
    expect([...(await listDismissedSlugs(FIRM, "user_b"))]).toEqual([]);
  });

  it("dismiss is idempotent", async () => {
    await dismissBuiltin(FIRM, "user_a", "foundation-plan");
    await dismissBuiltin(FIRM, "user_a", "foundation-plan");
    expect((await listDismissedSlugs(FIRM, "user_a")).size).toBe(1);
  });

  it("restore removes the dismissal", async () => {
    await dismissBuiltin(FIRM, "user_a", "foundation-plan");
    await restoreBuiltin(FIRM, "user_a", "foundation-plan");
    expect((await listDismissedSlugs(FIRM, "user_a")).size).toBe(0);
  });
});
