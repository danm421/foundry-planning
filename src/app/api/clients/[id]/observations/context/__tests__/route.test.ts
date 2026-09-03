import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  auditLog,
  scenarios,
  planObservationContext,
} from "@/db/schema";
import { eq } from "drizzle-orm";

// R9: the sibling fixture's orgId is hard-coded to that file's own firm
// constant ("firm_test_observations"). Copied verbatim it would make every
// request here cross-firm (GET 404s / PATCH 403s that look like route bugs).
// This orgId is corrected to match FIRM_A below.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_obs_context",
    orgId: "firm_test_obs_context",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM_A = "firm_test_obs_context";
const FIRM_B = "firm_test_obs_context_other";

let clientA: string;
let clientB: string;
let householdA: string;
let householdB: string;
let scenarioA: string;
let scenarioB: string;

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

beforeAll(async () => {
  const a = await seedClient(FIRM_A, "Alpha");
  const b = await seedClient(FIRM_B, "Beta");
  clientA = a.clientId;
  clientB = b.clientId;
  householdA = a.householdId;
  householdB = b.householdId;

  const [sa] = await db.insert(scenarios).values({ clientId: clientA, name: "Retire at 62", isBaseCase: false }).returning();
  const [sb] = await db.insert(scenarios).values({ clientId: clientB, name: "Other firm's plan", isBaseCase: false }).returning();
  scenarioA = sa.id;
  scenarioB = sb.id;
});

afterAll(async () => {
  await db.delete(planObservationContext).where(eq(planObservationContext.clientId, clientA));
  await db.delete(planObservationContext).where(eq(planObservationContext.clientId, clientB));
  await db.delete(scenarios).where(eq(scenarios.clientId, clientA));
  await db.delete(scenarios).where(eq(scenarios.clientId, clientB));
  await db.delete(clients).where(eq(clients.id, clientA));
  await db.delete(clients).where(eq(clients.id, clientB));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdA));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdB));
});

// Import AFTER mock + fixture setup
import { GET, PATCH } from "../route";

function makeReq(body?: unknown): NextRequest {
  return new Request("http://test/api", {
    method: body ? "PATCH" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

describe("GET /observations/context", () => {
  it("reads as empty strings and no scenario when the client has no row", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientA }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ observationsContext: "", nextStepsContext: "", nextStepsScenarioId: null });
  });
  it("404s cross-firm", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientB }) });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /observations/context", () => {
  it("upserts — first call inserts, second call updates only the field sent", async () => {
    const first = await PATCH(makeReq({ observationsContext: "They worry about college." }), { params: Promise.resolve({ id: clientA }) });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ observationsContext: "They worry about college.", nextStepsContext: "", nextStepsScenarioId: null });

    const second = await PATCH(makeReq({ nextStepsScenarioId: scenarioA }), { params: Promise.resolve({ id: clientA }) });
    expect(await second.json()).toEqual({ observationsContext: "They worry about college.", nextStepsContext: "", nextStepsScenarioId: scenarioA });

    const rows = await db.select().from(planObservationContext).where(eq(planObservationContext.clientId, clientA));
    expect(rows).toHaveLength(1);

    // A GET taken independently of the PATCH responses must reflect the same
    // persisted row — proves GET actually reads the table rather than
    // returning a fixed shape that happens to match the empty-row default.
    const afterWrite = await GET(makeReq(), { params: Promise.resolve({ id: clientA }) });
    expect(await afterWrite.json()).toEqual({ observationsContext: "They worry about college.", nextStepsContext: "", nextStepsScenarioId: scenarioA });
  });

  it("clears the scenario with null", async () => {
    const res = await PATCH(makeReq({ nextStepsScenarioId: null }), { params: Promise.resolve({ id: clientA }) });
    expect((await res.json()).nextStepsScenarioId).toBeNull();
  });

  it("400s on a scenario that belongs to another client", async () => {
    const res = await PATCH(makeReq({ nextStepsScenarioId: scenarioB }), { params: Promise.resolve({ id: clientA }) });
    expect(res.status).toBe(400);
  });

  it("400s on an empty body and on an unknown field", async () => {
    expect((await PATCH(makeReq({}), { params: Promise.resolve({ id: clientA }) })).status).toBe(400);
    expect((await PATCH(makeReq({ nope: 1 }), { params: Promise.resolve({ id: clientA }) })).status).toBe(400);
  });

  it("records a plan_observation_context.update audit entry", async () => {
    await PATCH(makeReq({ nextStepsContext: "Push the Roth conversion." }), { params: Promise.resolve({ id: clientA }) });
    const audits = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.clientId, clientA));
    expect(audits.map((a) => a.action)).toContain("plan_observation_context.update");
  });

  it("403s cross-firm", async () => {
    const res = await PATCH(makeReq({ observationsContext: "x" }), { params: Promise.resolve({ id: clientB }) });
    expect(res.status).toBe(403);
  });
});
