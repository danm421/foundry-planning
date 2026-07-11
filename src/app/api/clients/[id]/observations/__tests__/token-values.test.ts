import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_token_values",
    orgId: "firm_test_token_values",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

// Shared mock fns declared via vi.hoisted so vi.mock factories (hoisted above
// imports) can close over them, and beforeEach can mockClear them — this repo
// has been bitten before by stale shared mocks bleeding state across tests.
const { mockLoadEffectiveTree, mockRunProjectionWithEvents, mockGetOrComputeMonteCarlo } =
  vi.hoisted(() => ({
    mockLoadEffectiveTree: vi.fn(),
    mockRunProjectionWithEvents: vi.fn(),
    mockGetOrComputeMonteCarlo: vi.fn(),
  }));

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: mockLoadEffectiveTree,
}));
vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: mockRunProjectionWithEvents,
}));
vi.mock("@/lib/compute-cache/monte-carlo", () => ({
  getOrComputeMonteCarlo: mockGetOrComputeMonteCarlo,
}));

const FIRM = "firm_test_token_values";
const FIRM_OTHER = "firm_test_token_values_other";
let clientId: string;
let clientOtherId: string;
let householdId: string;
let householdOtherId: string;

async function seedClient(firmId: string, lastName: string): Promise<{ clientId: string; householdId: string }> {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "advisor_test", name: `${lastName} Household` })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: "Test",
    lastName,
    dateOfBirth: "1970-01-01",
  });
  const [client] = await db
    .insert(clients)
    .values({
      firmId,
      advisorId: "advisor_test",
      crmHouseholdId: household.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  return { clientId: client.id, householdId: household.id };
}

const FAKE_CLIENT_DATA = {
  client: {
    firstName: "Test",
    lastName: "Client",
    retirementAge: 65,
    planEndAge: 95,
  },
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: {},
} as unknown as ClientData;

const FAKE_YEAR = {
  year: 2026,
  ages: { client: 50 },
  liabilityBalancesBoY: {},
  portfolioAssets: { total: 1_000_000, liquidTotal: 900_000 },
  totalIncome: 100_000,
  expenses: { total: 50_000 },
  savings: { total: 20_000 },
};

const FAKE_PROJECTION = {
  years: [FAKE_YEAR],
} as unknown as ProjectionResult;

beforeAll(async () => {
  const a = await seedClient(FIRM, "Alpha");
  const b = await seedClient(FIRM_OTHER, "Beta");
  clientId = a.clientId;
  clientOtherId = b.clientId;
  householdId = a.householdId;
  householdOtherId = b.householdId;
});

afterAll(async () => {
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(clients).where(eq(clients.id, clientOtherId));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdOtherId));
});

beforeEach(() => {
  mockLoadEffectiveTree.mockClear();
  mockRunProjectionWithEvents.mockClear();
  mockGetOrComputeMonteCarlo.mockClear();
  mockLoadEffectiveTree.mockResolvedValue({ effectiveTree: FAKE_CLIENT_DATA });
  mockRunProjectionWithEvents.mockReturnValue(FAKE_PROJECTION);
  mockGetOrComputeMonteCarlo.mockResolvedValue({
    payload: { summary: { successRate: 0.87 } },
  });
});

// Import AFTER mocks are declared.
import { GET } from "../token-values/route";

function makeReq(search?: string): NextRequest {
  return new NextRequest(`http://test/api/token-values${search ? `?${search}` : ""}`);
}

describe("GET /api/clients/[id]/observations/token-values", () => {
  it("200s with a resolved token map including net_worth", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.values.net_worth).toBe("$1,000,000");
    expect(body.values.mc_success).toBe("87%");
  });

  it("passes scenario from the query string through to loadEffectiveTree", async () => {
    const res = await GET(makeReq("scenario=scn-1"), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(200);
    expect(mockLoadEffectiveTree).toHaveBeenCalledWith(clientId, FIRM, "scn-1", {});
  });

  it("defaults scenario to base when omitted", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(200);
    expect(mockLoadEffectiveTree).toHaveBeenCalledWith(clientId, FIRM, "base", {});
  });

  it("still 200s with mc_success: null when Monte Carlo rejects", async () => {
    mockGetOrComputeMonteCarlo.mockRejectedValue(new Error("mc failed"));
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.values.mc_success).toBeNull();
    expect(body.values.net_worth).toBe("$1,000,000");
  });

  it("404s on cross-firm read", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientOtherId }) });
    expect(res.status).toBe(404);
    expect(mockLoadEffectiveTree).not.toHaveBeenCalled();
  });

  it("404s when the client does not exist", async () => {
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});
