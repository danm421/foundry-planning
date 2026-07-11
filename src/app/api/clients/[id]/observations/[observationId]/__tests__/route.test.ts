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
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_observations_item",
    orgId: "firm_test_observations_item",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM = "firm_test_observations_item";
const FIRM_OTHER = "firm_test_observations_item_other";
let clientId: string;
let clientOtherId: string;
let householdId: string;
let householdOtherId: string;
let observationId: string;

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
  const a = await seedClient(FIRM, "Y");
  const b = await seedClient(FIRM_OTHER, "Z");
  clientId = a.clientId;
  clientOtherId = b.clientId;
  householdId = a.householdId;
  householdOtherId = b.householdId;
  const [row] = await db
    .insert(planObservations)
    .values({ clientId, section: "observation", body: "initial observation" })
    .returning();
  observationId = row.id;
});

afterAll(async () => {
  await db.delete(planObservations).where(eq(planObservations.clientId, clientId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(clients).where(eq(clients.id, clientOtherId));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdOtherId));
});

import { PATCH, DELETE } from "../route";

function req(body?: unknown): NextRequest {
  return new Request("http://t/", {
    method: body !== undefined ? "PATCH" : "DELETE",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

describe("PATCH /[observationId]", () => {
  it("updates a field and records plan_observation.update", async () => {
    const res = await PATCH(req({ title: "Renamed" }), {
      params: Promise.resolve({ id: clientId, observationId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Renamed");

    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.resourceId, observationId));
    expect(rows.some((r) => r.action === "plan_observation.update")).toBe(true);
  });

  it("marks status done, sets completedAt, and records plan_observation.complete", async () => {
    const res = await PATCH(req({ status: "done" }), {
      params: Promise.resolve({ id: clientId, observationId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.completedAt).not.toBeNull();

    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.resourceId, observationId));
    expect(rows.some((r) => r.action === "plan_observation.complete")).toBe(true);
  });

  it("clears completedAt when status leaves done", async () => {
    const res = await PATCH(req({ status: "open" }), {
      params: Promise.resolve({ id: clientId, observationId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");
    expect(body.completedAt).toBeNull();
  });

  it("404s when the observation doesn't exist", async () => {
    const res = await PATCH(req({ title: "ghost" }), {
      params: Promise.resolve({
        id: clientId,
        observationId: "00000000-0000-4000-8000-000000000000",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("403s across firms", async () => {
    const res = await PATCH(req({ title: "hacked" }), {
      params: Promise.resolve({ id: clientOtherId, observationId }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /[observationId]", () => {
  it("deletes the observation", async () => {
    const res = await DELETE(req(), {
      params: Promise.resolve({ id: clientId, observationId }),
    });
    expect(res.status).toBe(204);

    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.resourceId, observationId));
    expect(rows.some((r) => r.action === "plan_observation.delete")).toBe(true);
  });

  it("second delete returns 404", async () => {
    const res = await DELETE(req(), {
      params: Promise.resolve({ id: clientId, observationId }),
    });
    expect(res.status).toBe(404);
  });
});
