import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_FIRM = "test-firm-cp";
const TEST_USER = "test-user-cp";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "test-user-cp", orgId: "test-firm-cp" }),
}));

const buildMock = vi.fn();
vi.mock("@/lib/comparison/build-comparison-plans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/comparison/build-comparison-plans")>(
    "@/lib/comparison/build-comparison-plans",
  );
  return {
    ...actual,
    buildComparisonPlans: (...args: unknown[]) => buildMock(...args),
  };
});

// Stub the heavy projection/estate loaders so the test stays in-process.
vi.mock("@/lib/scenario/load-projection-for-ref", () => ({
  loadProjectionForRef: vi.fn(),
}));
vi.mock("@/lib/estate/yearly-estate-report", () => ({
  buildYearlyEstateReport: vi.fn(() => ({ rows: [] })),
}));
vi.mock("@/lib/estate/yearly-liquidity-report", () => ({
  buildYearlyLiquidityReport: vi.fn(() => ({ rows: [] })),
}));

import { POST } from "../route";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";

let testClientId: string;

beforeEach(async () => {
  buildMock.mockReset();
  const [c] = await db
    .insert(clients)
    .values({
      firmId: TEST_FIRM,
      advisorId: TEST_USER,
      firstName: "T",
      lastName: "U",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning({ id: clients.id });
  testClientId = c.id;
});

afterEach(async () => {
  await db.delete(clients).where(eq(clients.id, testClientId));
});

function makeParams() {
  return { params: Promise.resolve({ id: testClientId }) };
}

describe("POST /api/clients/[id]/comparison-plans", () => {
  it("400s when body has no plans array", async () => {
    const res = await POST(
      new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({}) }),
      makeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("400s when a plan token is not a string", async () => {
    const res = await POST(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ plans: [42] }),
      }),
      makeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("404s when the client doesn't belong to the firm", async () => {
    const [other] = await db
      .insert(clients)
      .values({
        firmId: "different-firm",
        advisorId: TEST_USER,
        firstName: "X",
        lastName: "Y",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 95,
      })
      .returning({ id: clients.id });
    const res = await POST(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ plans: ["base"] }),
      }),
      { params: Promise.resolve({ id: other.id }) },
    );
    expect(res.status).toBe(404);
    await db.delete(clients).where(eq(clients.id, other.id));
  });

  it("returns the array buildComparisonPlans produced", async () => {
    buildMock.mockResolvedValue([
      { id: "base", label: "Base case", result: { years: [] } },
    ]);
    const res = await POST(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ plans: ["base"] }),
      }),
      makeParams(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plans).toHaveLength(1);
    expect(json.plans[0].id).toBe("base");
  });

  it("dedupes repeated plan tokens before building", async () => {
    buildMock.mockResolvedValue([]);
    await POST(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ plans: ["base", "base", "sc-1"] }),
      }),
      makeParams(),
    );
    expect(buildMock).toHaveBeenCalledTimes(1);
    const args = buildMock.mock.calls[0][0] as { refs: { id: string }[] };
    expect(args.refs.map((r) => r.id)).toEqual(["base", "sc-1"]);
  });
});
