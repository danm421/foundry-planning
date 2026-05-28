import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/db";
import { presentationTemplates, firms } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_owner", orgId: "firm_test" })),
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

const validPages = [
  { pageId: "cashFlow", options: { range: "retirement", showCallout: true } },
];

async function seed(creator: string, name = "T1") {
  const { createTemplate } = await import("@/lib/presentations/templates-repo");
  return createTemplate({
    firmId: FIRM,
    createdByUserId: creator,
    name,
    visibility: "shared",
    pages: validPages as never,
  });
}

describe("PATCH /api/presentation-templates/[id]", () => {
  it("updates name when called by the creator", async () => {
    const t = await seed("user_owner");
    const { PATCH } = await import("../[id]/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }),
      { params: Promise.resolve({ id: t.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Renamed");
  });

  it("returns 403 when called by another user", async () => {
    const t = await seed("user_owner");
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_other", orgId: FIRM } as never);
    const { PATCH } = await import("../[id]/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "x" }) }),
      { params: Promise.resolve({ id: t.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for cross-firm access", async () => {
    const t = await seed("user_owner");
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_owner", orgId: "firm_other" } as never);
    const { PATCH } = await import("../[id]/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "x" }) }),
      { params: Promise.resolve({ id: t.id }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/presentation-templates/[id]", () => {
  it("deletes when called by the creator", async () => {
    const t = await seed("user_owner", "TD");
    const { DELETE } = await import("../[id]/route");
    const res = await DELETE(new Request("http://x"), { params: Promise.resolve({ id: t.id }) });
    expect(res.status).toBe(200);
  });

  it("returns 403 when called by another user", async () => {
    const t = await seed("user_owner", "TD2");
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_other", orgId: FIRM } as never);
    const { DELETE } = await import("../[id]/route");
    const res = await DELETE(new Request("http://x"), { params: Promise.resolve({ id: t.id }) });
    expect(res.status).toBe(403);
  });
});
