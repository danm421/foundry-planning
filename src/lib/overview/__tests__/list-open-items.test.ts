import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/db";
import { clients, clientOpenItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listOpenItems } from "@/lib/overview/list-open-items";

const FIRM = "firm_test_list_open_items";
let clientId: string;

beforeAll(async () => {
  const [c] = await db
    .insert(clients)
    .values({
      firmId: FIRM,
      advisorId: "advisor_test",
      firstName: "A",
      lastName: "A",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  clientId = c.id;
  await db.insert(clientOpenItems).values([
    { clientId, title: "Low",      priority: "low",    dueDate: "2027-01-01" },
    { clientId, title: "HighLate", priority: "high",   dueDate: "2026-01-01" },
    { clientId, title: "HighSoon", priority: "high",   dueDate: "2025-12-01" },
    { clientId, title: "Done",     priority: "medium", completedAt: new Date() },
  ]);
});

afterAll(async () => {
  await db.delete(clientOpenItems).where(eq(clientOpenItems.clientId, clientId));
  await db.delete(clients).where(eq(clients.id, clientId));
});

describe("listOpenItems", () => {
  it("returns open items only when open=true, sorted by priority DESC then due_date ASC", async () => {
    const rows = await listOpenItems(clientId, FIRM, { open: true, limit: 10 });
    expect(rows.map((r) => r.title)).toEqual(["HighSoon", "HighLate", "Low"]);
  });

  it("honors limit", async () => {
    const rows = await listOpenItems(clientId, FIRM, { open: true, limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("HighSoon");
  });

  it("returns empty for a foreign firm", async () => {
    const rows = await listOpenItems(clientId, "firm_nope", { open: true, limit: 10 });
    expect(rows).toEqual([]);
  });
});
