import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn(),
  };
});
vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn(),
}));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({
  applyMutations: vi.fn((tree) => tree),
}));
vi.mock("@/engine", () => ({
  runProjection: vi.fn(() => [{ year: 2026 }, { year: 2027 }]),
}));

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/solver/project`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

const MOCK_CLIENT_DATA = {
  client: {
    firstName: "Cooper",
    lastName: "Smith",
    dateOfBirth: "1965-03-15",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "single",
  },
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: {} as never,
} as never;

beforeEach(() => {
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: MOCK_CLIENT_DATA,
    warnings: [],
  } as never);
});

describe("POST /api/clients/[id]/solver/project", () => {
  it("returns 200 with the projection on happy path", async () => {
    const res = await POST(
      makeRequest({ source: "base", mutations: [] }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projection).toEqual([{ year: 2026 }, { year: 2027 }]);
    expect(runProjection).toHaveBeenCalled();
  });

  it("returns 404 when the client is not in the caller's firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await POST(
      makeRequest({ source: "base", mutations: [] }),
      ctx as never,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when the body fails schema validation", async () => {
    const res = await POST(
      makeRequest({ source: 123, mutations: "not-an-array" }),
      ctx as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when the engine throws", async () => {
    vi.mocked(runProjection).mockImplementationOnce(() => {
      throw new Error("engine boom");
    });
    const res = await POST(
      makeRequest({ source: "base", mutations: [] }),
      ctx as never,
    );
    expect(res.status).toBe(500);
  });
});
