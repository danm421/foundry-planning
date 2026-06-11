import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/db";
import { builtinTemplateDismissals, firms } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test", orgId: "firm_test" })),
}));

const FIRM = "firm_test";

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

function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("builtins dismiss route", () => {
  it("POST dismisses a known built-in", async () => {
    const { POST } = await import("../dismiss/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("foundation-plan"));
    expect(res.status).toBe(200);
    const rows = await db.select().from(builtinTemplateDismissals).where(eq(builtinTemplateDismissals.firmId, FIRM));
    expect(rows.map((r) => r.builtinSlug)).toEqual(["foundation-plan"]);
  });

  it("POST with an unknown slug returns 404", async () => {
    const { POST } = await import("../dismiss/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("not-a-real-slug"));
    expect(res.status).toBe(404);
  });

  it("DELETE restores a dismissed built-in", async () => {
    const { POST, DELETE } = await import("../dismiss/route");
    await POST(new Request("http://x", { method: "POST" }), ctx("foundation-plan"));
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx("foundation-plan"));
    expect(res.status).toBe(200);
    const rows = await db.select().from(builtinTemplateDismissals).where(eq(builtinTemplateDismissals.firmId, FIRM));
    expect(rows).toEqual([]);
  });
});
