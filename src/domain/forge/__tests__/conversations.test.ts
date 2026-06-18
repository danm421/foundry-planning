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
import { forgeConversations } from "@/db/schema";
import {
  createConversation,
  listMyConversations,
  touchConversation,
  userOwnsConversation,
} from "../conversations";

const FIRM = "org_forge_conv_test";
const USER_A = "user_forge_a";
const USER_B = "user_forge_b";

afterAll(async () => {
  await db.delete(forgeConversations).where(eq(forgeConversations.firmId, FIRM));
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
