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

const loadPanelDataMock = vi.fn();
vi.mock("@/lib/scenario/load-panel-data", () => ({
  loadPanelData: (...args: unknown[]) => loadPanelDataMock(...args),
}));

import { POST } from "../route";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";

let testClientId: string;

beforeEach(async () => {
  buildMock.mockReset();
  loadPanelDataMock.mockReset();
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

  it("returns panelData for a scenario plan ref", async () => {
    const scenarioId = "11111111-1111-1111-1111-111111111111";
    loadPanelDataMock.mockResolvedValue({
      scenarioId,
      scenarioName: "Test scenario",
      changes: [
        {
          id: "ch-1",
          scenarioId,
          opType: "edit",
          targetKind: "income",
          targetId: "22222222-2222-2222-2222-222222222222",
          payload: { amount: { from: 100, to: 200 } },
          toggleGroupId: null,
          orderIndex: 0,
          updatedAt: new Date(),
          enabled: true,
        },
      ],
      toggleGroups: [],
      cascadeWarnings: [],
      targetNames: {},
    });
    // Mirror real buildComparisonPlans: invoke loadPanel for each ref and
    // propagate the result into the returned plans.
    buildMock.mockImplementation(
      async (input: {
        refs: { kind: string; id: string }[];
        loadPanel: (
          ref: { kind: string; id: string },
          label: string,
        ) => Promise<unknown>;
      }) => {
        const panels = await Promise.all(
          input.refs.map((ref) => input.loadPanel(ref, "Test scenario")),
        );
        return input.refs.map((ref, i) => ({
          id: ref.id,
          label: "Test scenario",
          panelData: panels[i],
        }));
      },
    );

    const res = await POST(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ plans: [scenarioId] }),
      }),
      makeParams(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plans[0].panelData).not.toBeNull();
    expect(json.plans[0].panelData.changes).toHaveLength(1);
    // Sanity: loadPanelData was called with (clientId, scenarioId, firmId).
    expect(loadPanelDataMock).toHaveBeenCalledWith(testClientId, scenarioId, TEST_FIRM);
  });

  it("returns null panelData for base and snapshot refs", async () => {
    buildMock.mockImplementation(
      async (input: {
        refs: { kind: string; id: string }[];
        loadPanel: (
          ref: { kind: string; id: string },
          label: string,
        ) => Promise<unknown>;
      }) => {
        const panels = await Promise.all(
          input.refs.map((ref) => input.loadPanel(ref, "x")),
        );
        return input.refs.map((ref, i) => ({
          id: ref.id,
          label: "x",
          panelData: panels[i],
        }));
      },
    );

    const res = await POST(
      new NextRequest("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ plans: ["base", "snap:abc"] }),
      }),
      makeParams(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plans[0].panelData).toBeNull();
    expect(json.plans[1].panelData).toBeNull();
    expect(loadPanelDataMock).not.toHaveBeenCalled();
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
