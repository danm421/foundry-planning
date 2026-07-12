import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  clients,
  planObservations,
  crmHouseholds,
  crmHouseholdContacts,
  auditLog,
} from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_observations_reorder",
    orgId: "firm_test_observations_reorder",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM = "firm_test_observations_reorder";
const FIRM_OTHER = "firm_test_observations_reorder_other";
let clientId: string;
let clientOtherId: string;
let householdId: string;
let householdOtherId: string;
let obsIds: string[];

async function seedClient(firmId: string, lastName: string): Promise<{ clientId: string; householdId: string }> {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "advisor_test", name: `${lastName} Household` })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: "X",
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
  const a = await seedClient(FIRM, "R1");
  const b = await seedClient(FIRM_OTHER, "R2");
  clientId = a.clientId;
  clientOtherId = b.clientId;
  householdId = a.householdId;
  householdOtherId = b.householdId;

  const rows = await db
    .insert(planObservations)
    .values([
      { clientId, section: "observation", body: "first", sortOrder: 0 },
      { clientId, section: "observation", body: "second", sortOrder: 1 },
      { clientId, section: "observation", body: "third", sortOrder: 2 },
    ])
    .returning();
  obsIds = rows.map((r) => r.id);
});

afterAll(async () => {
  await db.delete(planObservations).where(eq(planObservations.clientId, clientId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(clients).where(eq(clients.id, clientOtherId));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdOtherId));
});

import { PUT } from "../route";

function req(body: unknown): NextRequest {
  return new Request("http://t/", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

describe("PUT /api/clients/[id]/observations/reorder", () => {
  it("400s with 'Stale order' when the id set doesn't match the section exactly (missing id)", async () => {
    const res = await PUT(
      req({ section: "observation", orderedIds: [obsIds[0], obsIds[1]] }),
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Stale order");
  });

  it("400s with 'Stale order' when an unknown id is included", async () => {
    const res = await PUT(
      req({
        section: "observation",
        orderedIds: [...obsIds, "00000000-0000-4000-8000-000000000000"],
      }),
      { params: Promise.resolve({ id: clientId }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Stale order");
  });

  it("403s across firms", async () => {
    const res = await PUT(req({ section: "observation", orderedIds: obsIds }), {
      params: Promise.resolve({ id: clientOtherId }),
    });
    expect(res.status).toBe(403);
  });

  it("rewrites sortOrder 0..n-1 for the reversed order and records plan_observation.reorder", async () => {
    const reversed = [...obsIds].reverse();
    const res = await PUT(req({ section: "observation", orderedIds: reversed }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    const rows = await db
      .select({ id: planObservations.id, sortOrder: planObservations.sortOrder })
      .from(planObservations)
      .where(and(eq(planObservations.clientId, clientId), eq(planObservations.section, "observation")))
      .orderBy(asc(planObservations.sortOrder));
    expect(rows.map((r) => r.id)).toEqual(reversed);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);

    const auditRows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.clientId, clientId));
    expect(auditRows.some((r) => r.action === "plan_observation.reorder")).toBe(true);
  });
});
