import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: vi.fn() }));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
}));
// Phase 1b: verifyClientAccess now owns the client-in-firm gate (replaces
// findClientInFirm). Delegate to the already-mocked findClientInFirm so tests
// that set findClientInFirm → null still exercise the 404 path.
vi.mock("@/lib/clients/authz", () => ({
  // verifyClientAccess is now 1-arg. Source the firm from the test's FIRM_ID
  // (inlined — vi.mock is hoisted above the const) and return the object shape;
  // tests that set findClientInFirm → null still drive the 404 path.
  verifyClientAccess: vi.fn().mockImplementation(async (clientId: string) => {
    const { findClientInFirm } = await import("@/lib/db-scoping");
    const client = await findClientInFirm(clientId, "00000000-0000-4000-8000-000000000099");
    return client != null
      ? { ok: true, permission: "edit", firmId: "00000000-0000-4000-8000-000000000099", access: "own" }
      : { ok: false };
  }),
}));

const insertedScenarios: unknown[] = [];
const insertedChanges: unknown[] = [];
vi.mock("@/db", () => ({
  db: {
    transaction: vi.fn(async (fn) => {
      const tx = {
        insert: (_table: unknown) => ({
          values: (rows: unknown) => ({
            returning: async () => {
              if (Array.isArray(rows)) {
                insertedChanges.push(...rows);
                return rows;
              }
              insertedScenarios.push(rows);
              return [{ id: "new-scenario-id", ...(rows as object) }];
            },
          }),
        }),
      };
      return await fn(tx);
    }),
  },
}));

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { recordAudit } from "@/lib/audit";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/solver/save-scenario`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

beforeEach(() => {
  insertedScenarios.length = 0;
  insertedChanges.length = 0;
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: {
      client: {
        firstName: "Cooper",
        lastName: "Smith",
        dateOfBirth: "1965-03-15",
        retirementAge: 65,
        retirementMonth: 1,
        planEndAge: 95,
        lifeExpectancy: 95,
        filingStatus: "single",
      },
      accounts: [],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {} as never,
    },
    warnings: [],
  } as never);
});

describe("POST /api/clients/[id]/solver/save-scenario", () => {
  it("inserts a scenarios row and matching change rows for a single mutation", async () => {
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "Retire at 67",
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(insertedScenarios).toHaveLength(1);
    expect(insertedChanges).toHaveLength(1);
    expect(insertedChanges[0]).toMatchObject({
      targetKind: "client",
      opType: "edit",
      payload: { retirementAge: { from: 65, to: 67 } },
    });
  });

  it("records an audit row with source: solver", async () => {
    await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "Retire at 67",
      }),
      ctx as never,
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario.create",
        metadata: expect.objectContaining({ source: "solver", mutationCount: 1 }),
      }),
    );
  });

  it("returns 400 when name is empty", async () => {
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "",
      }),
      ctx as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the client is not in the caller's firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "x",
      }),
      ctx as never,
    );
    expect(res.status).toBe(404);
  });
});
