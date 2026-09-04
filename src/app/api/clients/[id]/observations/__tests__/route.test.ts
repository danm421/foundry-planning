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
import { and, eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_observations",
    orgId: "firm_test_observations",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM_A = "firm_test_observations";
const FIRM_B = "firm_test_observations_other";

let clientA: string;
let clientB: string;
let householdA: string;
let householdB: string;

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
});

afterAll(async () => {
  await db.delete(planObservations).where(eq(planObservations.clientId, clientA));
  await db.delete(planObservations).where(eq(planObservations.clientId, clientB));
  await db.delete(clients).where(eq(clients.id, clientA));
  await db.delete(clients).where(eq(clients.id, clientB));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdA));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdB));
});

// Import AFTER mock + fixture setup
import { GET, POST, DELETE } from "../route";

function makeReq(body?: unknown, init?: { method?: string; query?: string }): NextRequest {
  const method = init?.method ?? (body ? "POST" : "GET");
  return new Request(`http://test/api${init?.query ? `?${init.query}` : ""}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

describe("POST /api/clients/[id]/observations", () => {
  it("creates an observation with minimal body", async () => {
    const res = await POST(
      makeReq({ section: "observation", body: "Client wants to retire at 62." }),
      { params: Promise.resolve({ id: clientA }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.section).toBe("observation");
    expect(body.body).toBe("Client wants to retire at 62.");
    expect(body.topic).toBe("general");
    expect(body.source).toBe("manual");
    expect(body.status).toBe("open");
    expect(body.sortOrder).toBe(0);
    expect(body.completedAt).toBeNull();
  });

  it("increments sortOrder within the same section", async () => {
    const res = await POST(
      makeReq({ section: "observation", body: "Second observation." }),
      { params: Promise.resolve({ id: clientA }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sortOrder).toBe(1);
  });

  it("tracks sortOrder independently per section", async () => {
    const res = await POST(
      makeReq({ section: "next_step", body: "First next step." }),
      { params: Promise.resolve({ id: clientA }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sortOrder).toBe(0);
  });

  it("records a plan_observation.create audit entry", async () => {
    const res = await POST(
      makeReq({ section: "observation", body: "Audited observation." }),
      { params: Promise.resolve({ id: clientA }) },
    );
    const body = await res.json();
    const rows = await db
      .select({
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        resourceId: auditLog.resourceId,
      })
      .from(auditLog)
      .where(eq(auditLog.resourceId, body.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].action).toBe("plan_observation.create");
    expect(rows[0].resourceType).toBe("plan_observation");
  });

  it("403s when the client is in a different firm", async () => {
    const res = await POST(makeReq({ section: "observation", body: "hack" }), {
      params: Promise.resolve({ id: clientB }),
    });
    expect(res.status).toBe(403);
  });

  it("400s on invalid body (empty body text)", async () => {
    const res = await POST(makeReq({ section: "observation", body: "" }), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(400);
  });

  it("400s on invalid section", async () => {
    const res = await POST(makeReq({ section: "bogus", body: "x" }), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/clients/[id]/observations", () => {
  beforeAll(async () => {
    // Deterministic fixture, inserted out of order, to prove the route's
    // ORDER BY (section, sortOrder, createdAt) rather than insertion order.
    await db.insert(planObservations).values([
      { clientId: clientA, section: "next_step", body: "next-step B", sortOrder: 1 },
      { clientId: clientA, section: "observation", body: "obs B", sortOrder: 1 },
      { clientId: clientA, section: "next_step", body: "next-step A", sortOrder: 0 },
      { clientId: clientA, section: "observation", body: "obs A", sortOrder: 0 },
    ]);
  });

  it("orders by (section asc, sortOrder asc, createdAt asc)", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientA }) });
    expect(res.status).toBe(200);
    const body: { body: string }[] = await res.json();
    const filtered = body
      .map((r) => r.body)
      .filter((b) => ["obs A", "obs B", "next-step A", "next-step B"].includes(b));
    expect(filtered).toEqual(["obs A", "obs B", "next-step A", "next-step B"]);
  });

  it("lists items for the client", async () => {
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("404s on cross-firm read", async () => {
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: clientB }),
    });
    expect(res.status).toBe(404);
  });
});

describe("audience and provenance", () => {
  it("POST stores audience and sourceScenarioId, defaulting audience to client", async () => {
    const a = await POST(
      makeReq({ section: "next_step", body: "Update the deferral election.", source: "ai", sourceScenarioId: "11111111-1111-4111-8111-111111111111" }),
      { params: Promise.resolve({ id: clientA }) },
    );
    expect(a.status).toBe(201);
    const row = await a.json();
    expect(row.audience).toBe("client");
    expect(row.sourceScenarioId).toBe("11111111-1111-4111-8111-111111111111");

    const b = await POST(
      makeReq({ section: "observation", body: "Advisor-only reminder.", audience: "advisor" }),
      { params: Promise.resolve({ id: clientA }) },
    );
    expect((await b.json()).audience).toBe("advisor");
  });

  it("GET ?audience=client omits advisor rows; GET without it returns everything", async () => {
    const all = (await (await GET(makeReq(), { params: Promise.resolve({ id: clientA }) })).json()) as Array<{ audience: string }>;
    expect(all.some((r) => r.audience === "advisor")).toBe(true);

    const client = (await (
      await GET(makeReq(undefined, { query: "audience=client" }), { params: Promise.resolve({ id: clientA }) })
    ).json()) as Array<{ audience: string }>;
    expect(client.length).toBeGreaterThan(0);
    expect(client.every((r) => r.audience === "client")).toBe(true);
  });

  it("GET 400s on an unknown audience", async () => {
    const res = await GET(makeReq(undefined, { query: "audience=everyone" }), { params: Promise.resolve({ id: clientA }) });
    expect(res.status).toBe(400);
  });

  it("DELETE ?section=next_step&source=ai removes only AI next steps for the client audience, audited", async () => {
    await POST(makeReq({ section: "next_step", body: "Hand-typed step." }), { params: Promise.resolve({ id: clientA }) });
    await POST(makeReq({ section: "next_step", body: "AI step 1.", source: "ai" }), { params: Promise.resolve({ id: clientA }) });
    await POST(makeReq({ section: "next_step", body: "AI step 2.", source: "ai" }), { params: Promise.resolve({ id: clientA }) });
    await POST(makeReq({ section: "observation", body: "AI observation stays.", source: "ai" }), { params: Promise.resolve({ id: clientA }) });
    // Same section AND same source as the rows being cleared, but advisor
    // audience — the only thing distinguishing it from the rows that must be
    // deleted. If the route's `where` ever drops the `audience = 'client'`
    // predicate, this row gets swept too and the survivor assertion below
    // catches it.
    const advisorAiRes = await POST(
      makeReq({ section: "next_step", body: "Advisor-only AI step.", source: "ai", audience: "advisor" }),
      { params: Promise.resolve({ id: clientA }) },
    );
    const advisorAiRow = await advisorAiRes.json();
    // Identical section, source and audience to the rows being cleared, but a
    // DIFFERENT client in a different firm. POST 403s cross-firm before it
    // could write this, so insert directly. If the route's `where` ever drops
    // the `clientId = id` predicate, this row gets swept too and the survivor
    // assertion below catches it — the one predicate whose failure mode is
    // another firm's data being destroyed.
    const [otherFirmRow] = await db
      .insert(planObservations)
      .values({ clientId: clientB, section: "next_step", body: "Other firm AI step.", source: "ai" })
      .returning();

    // The exact rows the DELETE is about to destroy, read before it runs —
    // the only way to check the audit names them rather than just counting.
    const doomed = await db
      .select({ id: planObservations.id })
      .from(planObservations)
      .where(
        and(
          eq(planObservations.clientId, clientA),
          eq(planObservations.section, "next_step"),
          eq(planObservations.source, "ai"),
          eq(planObservations.audience, "client"),
        ),
      );

    const res = await DELETE(makeReq(undefined, { method: "DELETE", query: "section=next_step&source=ai" }), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(200);
    const { removed } = await res.json();
    expect(removed).toBeGreaterThanOrEqual(3); // the two here + the provenance row above

    const left = await db.select().from(planObservations).where(eq(planObservations.clientId, clientA));
    expect(left.some((r) => r.section === "next_step" && r.source === "ai" && r.audience === "client")).toBe(false);
    expect(left.some((r) => r.section === "next_step" && r.source === "manual")).toBe(true);
    expect(left.some((r) => r.section === "observation" && r.source === "ai")).toBe(true);
    expect(left.some((r) => r.id === advisorAiRow.id)).toBe(true);

    const otherFirmLeft = await db
      .select()
      .from(planObservations)
      .where(eq(planObservations.clientId, clientB));
    expect(otherFirmLeft.some((r) => r.id === otherFirmRow.id)).toBe(true);

    const audits = await db
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.clientId, clientA));
    expect(audits.map((a) => a.action)).toContain("plan_observation.clear_ai");

    // A bulk delete of client-facing rows that logs only a COUNT leaves nobody
    // able to say WHICH rows went. The ids are the reconstruction.
    const clearAi = audits.filter((a) => a.action === "plan_observation.clear_ai");
    expect(clearAi).toHaveLength(1);
    const meta = clearAi[0].metadata as { section?: string; removed?: number; ids?: string[] } | null;
    expect(meta?.section).toBe("next_step");
    expect(meta?.removed).toBe(removed);
    expect([...(meta?.ids ?? [])].sort()).toEqual(doomed.map((r) => r.id).sort());
    expect(meta?.ids).toHaveLength(removed);
  });

  it("DELETE 400s without source=ai — hand-typed rows are never bulk-deleted", async () => {
    const res = await DELETE(makeReq(undefined, { method: "DELETE", query: "section=next_step&source=manual" }), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE 403s cross-firm", async () => {
    const res = await DELETE(makeReq(undefined, { method: "DELETE", query: "section=next_step&source=ai" }), {
      params: Promise.resolve({ id: clientB }),
    });
    expect(res.status).toBe(403);
  });
});
