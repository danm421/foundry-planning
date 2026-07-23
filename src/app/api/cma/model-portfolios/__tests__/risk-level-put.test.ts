import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { modelPortfolios } from "@/db/schema";
import { eq } from "drizzle-orm";

// vi.mock factories are hoisted above the module's top-level statements, so
// FIRM must be produced via vi.hoisted() rather than a plain `const` — a bare
// const throws "Cannot access 'FIRM' before initialization" here.
const { FIRM } = vi.hoisted(() => ({ FIRM: `test-cma-put-${Date.now()}` }));

// Mock the authz + org helpers this route uses so the handler runs headless.
vi.mock("@/lib/authz", () => ({
  requireOrgAdminOrOwner: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn().mockResolvedValue(FIRM) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

import { PUT } from "@/app/api/cma/model-portfolios/[id]/route";

function req(body: unknown) {
  return new Request("http://t", { method: "PUT", body: JSON.stringify(body) }) as never;
}

afterAll(async () => {
  await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, FIRM));
});

describe("PUT model-portfolios/[id] risk level", () => {
  it("tags, rejects a duplicate rung (409), rejects a bad value (400), preserves description on a partial update", async () => {
    const [a] = await db.insert(modelPortfolios)
      .values({ firmId: FIRM, name: "A", description: "keep me" }).returning();
    const [b] = await db.insert(modelPortfolios)
      .values({ firmId: FIRM, name: "B" }).returning();

    // Tag A = moderate (partial update: no name/description in body)
    let res = await PUT(req({ riskLevel: "moderate" }), { params: Promise.resolve({ id: a.id }) });
    expect(res.status).toBe(200);
    const [rowA] = await db.select().from(modelPortfolios).where(eq(modelPortfolios.id, a.id));
    expect(rowA.riskLevel).toBe("moderate");
    expect(rowA.description).toBe("keep me"); // NOT wiped by the partial update

    // B = moderate → 409 (rung taken)
    res = await PUT(req({ riskLevel: "moderate" }), { params: Promise.resolve({ id: b.id }) });
    expect(res.status).toBe(409);

    // Bad enum value → 400
    res = await PUT(req({ riskLevel: "balanced" }), { params: Promise.resolve({ id: b.id }) });
    expect(res.status).toBe(400);

    // Untag A (null) then B can take moderate
    await PUT(req({ riskLevel: null }), { params: Promise.resolve({ id: a.id }) });
    res = await PUT(req({ riskLevel: "moderate" }), { params: Promise.resolve({ id: b.id }) });
    expect(res.status).toBe(200);
  });
});
