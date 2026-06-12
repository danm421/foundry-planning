import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/db";
import { presentationTemplates, firms } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test", orgId: "firm_test" })),
}));

const FIRM = "firm_test";

async function ensureFirm() {
  await db.insert(firms).values({ firmId: FIRM, displayName: "Test Firm" }).onConflictDoNothing();
}
async function cleanupTemplates() {
  await db.delete(presentationTemplates).where(eq(presentationTemplates.firmId, FIRM));
}
async function cleanupFirm() {
  await db.delete(firms).where(eq(firms.firmId, FIRM));
}

beforeAll(ensureFirm);
beforeEach(cleanupTemplates);
afterAll(async () => {
  await cleanupTemplates();
  await cleanupFirm();
});

describe("GET /api/presentation-templates", () => {
  it("returns 401 when no org", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: "u", orgId: null } as never);
    const { GET } = await import("../route");
    const res = await GET(new Request("http://x/api/presentation-templates"));
    expect(res.status).toBe(401);
  });

  it("returns { shared, mine } for the firm", async () => {
    const { createTemplate } = await import("@/lib/presentations/templates-repo");
    await createTemplate({ firmId: FIRM, createdByUserId: "user_test", name: "S", visibility: "shared", pages: [{ pageId: "cashFlow", options: { range: "full", showCallout: true } }] });
    await createTemplate({ firmId: FIRM, createdByUserId: "user_test", name: "P", visibility: "private", pages: [{ pageId: "cashFlow", options: { range: "full", showCallout: false } }] });

    const { GET } = await import("../route");
    const res = await GET(new Request("http://x/api/presentation-templates"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shared.map((t: { name: string }) => t.name)).toEqual(["S"]);
    expect(body.mine.map((t: { name: string }) => t.name)).toEqual(["P"]);
  });

  it("includes built-in starter templates", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("http://x/api/presentation-templates"));
    const body = await res.json();
    expect(body.builtIn.map((t: { slug: string }) => t.slug)).toEqual([
      "foundation-plan",
      "cash-flow-details",
    ]);
    expect(body.builtInHidden).toEqual([]);
  });
});
