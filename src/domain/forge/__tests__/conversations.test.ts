// src/domain/forge/__tests__/conversations.test.ts
import { describe, it, expect, afterAll, vi } from "vitest";
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require("dotenv");
  config({ path: ".env.local" });
  config({ path: ".env", override: false });
});
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholds, forgeConversations } from "@/db/schema";
import {
  createConversation,
  listMyConversations,
  touchConversation,
  userOwnsConversation,
  renameConversation,
  deleteConversation,
} from "../conversations";

const FIRM = "org_forge_conv_test";
const USER_A = "user_forge_a";
const USER_B = "user_forge_b";

/** Create a minimal client row (with its CRM household) and return the client id. */
async function seedClient(label: string): Promise<string> {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM, advisorId: USER_A, name: `${label} HH` })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({ firmId: FIRM, advisorId: USER_A, crmHouseholdId: h.id, retirementAge: 65, planEndAge: 95, lifeExpectancy: 95, filingStatus: "single" })
    .returning({ id: clients.id });
  return c.id;
}

afterAll(async () => {
  await db.delete(forgeConversations).where(eq(forgeConversations.firmId, FIRM));
  await db.delete(clients).where(eq(clients.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
});

describe("forge conversations CRUD", () => {
  it("creates then lists a conversation for its owner", async () => {
    const id = await createConversation({ userId: USER_A, firmId: FIRM, title: "First" });
    const rows = await listMyConversations(USER_A, FIRM);
    expect(rows.map((r) => r.id)).toContain(id);
    expect(rows.find((r) => r.id === id)?.title).toBe("First");
  });

  it("does NOT list another user's conversation", async () => {
    const id = await createConversation({ userId: USER_A, firmId: FIRM, title: "A-owned" });
    const bRows = await listMyConversations(USER_B, FIRM);
    expect(bRows.map((r) => r.id)).not.toContain(id);
  });

  it("touchConversation is a no-op for a non-owner, succeeds for the owner", async () => {
    const id = await createConversation({ userId: USER_A, firmId: FIRM, title: "Original" });
    await touchConversation(id, USER_B, "hacked");
    const [afterB] = await db
      .select({ title: forgeConversations.title })
      .from(forgeConversations)
      .where(eq(forgeConversations.id, id));
    expect(afterB.title).toBe("Original");

    await touchConversation(id, USER_A, "renamed");
    const [afterA] = await db
      .select({ title: forgeConversations.title })
      .from(forgeConversations)
      .where(eq(forgeConversations.id, id));
    expect(afterA.title).toBe("renamed");
  });

  it("userOwnsConversation returns false for another user (IDOR guard)", async () => {
    const id = await createConversation({ userId: USER_A, firmId: FIRM, title: "Owned by A" });
    expect(await userOwnsConversation(id, USER_A)).toBe(true);
    expect(await userOwnsConversation(id, USER_B)).toBe(false);
  });
});

describe("listMyConversations with clientId filter", () => {
  it("returns only threads for the specified clientId", async () => {
    const client1Id = await seedClient("FilterClient1");
    const client2Id = await seedClient("FilterClient2");

    const idC1 = await createConversation({ userId: USER_A, firmId: FIRM, clientId: client1Id, title: "C1 thread" });
    const idC2 = await createConversation({ userId: USER_A, firmId: FIRM, clientId: client2Id, title: "C2 thread" });
    const idNull = await createConversation({ userId: USER_A, firmId: FIRM, title: "No client" });

    const rowsC1 = await listMyConversations(USER_A, FIRM, client1Id);
    const ids = rowsC1.map((r) => r.id);
    expect(ids).toContain(idC1);
    expect(ids).not.toContain(idC2);
    expect(ids).not.toContain(idNull);
  });

  it("without clientId returns all threads (including client-scoped)", async () => {
    const client1Id = await seedClient("FilterClient3");

    const idC1 = await createConversation({ userId: USER_A, firmId: FIRM, clientId: client1Id, title: "C1 thread 2" });
    const idNull = await createConversation({ userId: USER_A, firmId: FIRM, title: "No client 2" });

    const all = await listMyConversations(USER_A, FIRM);
    const ids = all.map((r) => r.id);
    expect(ids).toContain(idC1);
    expect(ids).toContain(idNull);
  });
});

describe("renameConversation", () => {
  it("renames the thread for the owner", async () => {
    const id = await createConversation({ userId: USER_A, firmId: FIRM, title: "Before rename" });
    await renameConversation(id, USER_A, "After rename");
    const [row] = await db
      .select({ title: forgeConversations.title })
      .from(forgeConversations)
      .where(eq(forgeConversations.id, id));
    expect(row.title).toBe("After rename");
  });

  it("is a no-op for a non-owner (owner-pinned)", async () => {
    const id = await createConversation({ userId: USER_A, firmId: FIRM, title: "Protected title" });
    await renameConversation(id, USER_B, "Hijacked title");
    const [row] = await db
      .select({ title: forgeConversations.title })
      .from(forgeConversations)
      .where(eq(forgeConversations.id, id));
    expect(row.title).toBe("Protected title");
  });
});

describe("deleteConversation", () => {
  it("deletes the thread for the owner", async () => {
    const id = await createConversation({ userId: USER_A, firmId: FIRM, title: "To be deleted" });
    await deleteConversation(id, USER_A);
    const rows = await db
      .select({ id: forgeConversations.id })
      .from(forgeConversations)
      .where(eq(forgeConversations.id, id));
    expect(rows).toHaveLength(0);
  });

  it("is a no-op for a non-owner (leaves the row intact)", async () => {
    const id = await createConversation({ userId: USER_A, firmId: FIRM, title: "Non-owner delete attempt" });
    await deleteConversation(id, USER_B);
    const rows = await db
      .select({ id: forgeConversations.id })
      .from(forgeConversations)
      .where(eq(forgeConversations.id, id));
    expect(rows).toHaveLength(1);
  });
});
