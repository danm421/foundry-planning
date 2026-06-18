import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  clients,
  clientOpenItems,
  crmHouseholds,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_itemId",
    orgId: "firm_test_itemId",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM = "firm_test_itemId";
const FIRM_OTHER = "firm_test_itemId_other";
let clientId: string;
let clientOtherId: string;
let householdId: string;
let householdOtherId: string;
let itemId: string;

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
    .insert(clientOpenItems)
    .values({ clientId, title: "initial", priority: "medium" })
    .returning();
  itemId = row.id;
});

afterAll(async () => {
  await db.delete(clientOpenItems).where(eq(clientOpenItems.clientId, clientId));
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

describe("PATCH /[itemId]", () => {
  it("marks the item complete", async () => {
    const res = await PATCH(req({ completedAt: new Date().toISOString() }), {
      params: Promise.resolve({ id: clientId, itemId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completedAt).not.toBeNull();
  });

  it("reopens the item (null completedAt)", async () => {
    const res = await PATCH(req({ completedAt: null }), {
      params: Promise.resolve({ id: clientId, itemId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completedAt).toBeNull();
  });

  it("403s across firms", async () => {
    const res = await PATCH(req({ title: "hacked" }), {
      params: Promise.resolve({ id: clientOtherId, itemId }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /[itemId]", () => {
  it("deletes the item", async () => {
    const res = await DELETE(req(), {
      params: Promise.resolve({ id: clientId, itemId }),
    });
    expect(res.status).toBe(204);
  });

  it("second delete returns 404", async () => {
    const res = await DELETE(req(), {
      params: Promise.resolve({ id: clientId, itemId }),
    });
    expect(res.status).toBe(404);
  });
});
