import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, clientOpenItems } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test_itemId", orgId: "firm_test_itemId" })),
}));

const FIRM = "firm_test_itemId";
const FIRM_OTHER = "firm_test_itemId_other";
let clientId: string;
let clientOtherId: string;
let itemId: string;

beforeAll(async () => {
  const [c] = await db
    .insert(clients)
    .values({
      firmId: FIRM,
      advisorId: "advisor_test",
      firstName: "X",
      lastName: "Y",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  const [o] = await db
    .insert(clients)
    .values({
      firmId: FIRM_OTHER,
      advisorId: "advisor_test",
      firstName: "X",
      lastName: "Z",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  clientId = c.id;
  clientOtherId = o.id;
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

  it("404s across firms", async () => {
    const res = await PATCH(req({ title: "hacked" }), {
      params: Promise.resolve({ id: clientOtherId, itemId }),
    });
    expect(res.status).toBe(404);
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
