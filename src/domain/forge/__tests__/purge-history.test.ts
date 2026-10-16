// Forge keeps each chat's history (LangGraph checkpoints, keyed only by thread
// id = forge_conversations.id) and its saved notes (LangGraph store, keyed by
// "<firmId>:<clientId|userId>") in tables no foreign key reaches, so no cascade
// erases them. Every deletion path — deleting a conversation, permanently
// deleting a household, purging a firm — must erase them explicitly, and
// nothing that belongs to anyone else.
//
// Real DB (shared dev branch) with dummy ids; Clerk, Plaid, Stripe, Blob and
// audit writes are mocked. Every row seeded here, LangGraph rows included, is
// removed in afterAll.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholds, firms, forgeConversations } from "@/db/schema";

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return {
    ...actual,
    auth: vi.fn(),
    clerkClient: async () => ({ organizations: { deleteOrganization: vi.fn() } }),
  };
});
vi.mock("@/lib/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit")>()),
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/audit/record-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit/record-helpers")>()),
  recordDelete: vi.fn(),
}));
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({ itemRemove: vi.fn() }) }));
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ customers: { del: vi.fn() } }),
}));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));
// purgeFirmById's live-subscription count is not tied to the firm being purged
// (it counts every live subscription on the branch), so on a branch with any
// paying firm no firm is eligible. This file tests what a purge erases, not who
// may be purged, so the eligibility check is stubbed open.
vi.mock("@/lib/billing/purge-eligibility", () => ({ isFirmPurgeable: () => true }));

import { deleteConversation } from "../conversations";
import { getStore } from "../store";
import { purgeCrmHouseholdById } from "@/lib/crm/households";
import { purgeFirmById } from "@/lib/billing/purge-firm";

const FIRM = "org_n7_forge_erase";
// A share recipient: its own firm id, chatting about FIRM's client. Its id
// also starts with FIRM's, so a prefix match on FIRM would wrongly reach it.
const SHARE_FIRM = "org_n7_forge_erase_recipient";
const PURGE_FIRM = "org_n7_ab";
const PREFIX_FIRM = "org_n7_abc"; // starts with PURGE_FIRM
const WILDCARD_FIRM = "org-n7_ab"; // matches PURGE_FIRM under an unescaped LIKE '_'
const TEST_FIRMS = [FIRM, SHARE_FIRM, PURGE_FIRM, PREFIX_FIRM, WILDCARD_FIRM];
const USER = "user_n7_owner";
const OTHER_USER = "user_n7_other";
const NOTE_KEY = "n7-note";

const seededThreads: string[] = [];

async function seedHousehold(firmId: string): Promise<{ householdId: string; clientId: string }> {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: USER, name: "N7 Forge HH" })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({ firmId, advisorId: USER, crmHouseholdId: h.id, retirementAge: 65, planEndAge: 95 })
    .returning();
  return { householdId: h.id, clientId: c.id };
}

/** A conversation plus one row in each LangGraph checkpoint table for its thread. */
async function seedConversation(
  firmId: string,
  clientId: string | null,
  userId = USER,
): Promise<string> {
  const [row] = await db
    .insert(forgeConversations)
    .values({ firmId, clientId, userId })
    .returning({ id: forgeConversations.id });
  seededThreads.push(row.id);
  await db.execute(sql`
    insert into checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
    values (${row.id}, '', 'cp-1', '{}', '{}')`);
  await db.execute(sql`
    insert into checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob)
    values (${row.id}, '', 'messages', '1', 'json', null)`);
  await db.execute(sql`
    insert into checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
    values (${row.id}, '', 'cp-1', 'task-1', 0, 'messages', 'json', decode('00', 'hex'))`);
  return row.id;
}

async function checkpointRows(threadId: string): Promise<number> {
  const { rows } = await db.execute<{ n: string }>(sql`
    select (select count(*) from checkpoints where thread_id = ${threadId})
         + (select count(*) from checkpoint_blobs where thread_id = ${threadId})
         + (select count(*) from checkpoint_writes where thread_id = ${threadId}) as n`);
  return Number(rows[0].n);
}

// Seeded and read through the real library, so the namespace encoding the
// purge matches is the one the library actually writes.
async function seedNote(namespace: string[]): Promise<void> {
  await getStore().put(namespace, NOTE_KEY, { value: "dummy note" });
}
async function hasNote(namespace: string[]): Promise<boolean> {
  return (await getStore().get(namespace, NOTE_KEY)) !== null;
}

async function cleanup(): Promise<void> {
  const threads = [
    ...seededThreads,
    ...(
      await db
        .select({ id: forgeConversations.id })
        .from(forgeConversations)
        .where(inArray(forgeConversations.firmId, TEST_FIRMS))
    ).map((r) => r.id),
  ];
  if (threads.length > 0) {
    await db.execute(sql`delete from checkpoints where thread_id in ${threads}`);
    await db.execute(sql`delete from checkpoint_blobs where thread_id in ${threads}`);
    await db.execute(sql`delete from checkpoint_writes where thread_id in ${threads}`);
  }
  await db.execute(sql`delete from store where split_part(namespace_path, ':', 1) in ${TEST_FIRMS}`);
  await db.delete(forgeConversations).where(inArray(forgeConversations.firmId, TEST_FIRMS));
  await db.delete(clients).where(inArray(clients.firmId, TEST_FIRMS));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, TEST_FIRMS));
  await db.delete(firms).where(inArray(firms.firmId, TEST_FIRMS));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await getStore().stop();
});

describe("Forge chat history and notes are erased with what they belong to", () => {
  it("deleting a conversation erases that thread's checkpoints, for its owner only", async () => {
    const target = await seedConversation(FIRM, null);
    const sibling = await seedConversation(FIRM, null);
    expect(await checkpointRows(target)).toBe(3);

    await deleteConversation(target, OTHER_USER); // not the owner: a no-op
    expect(await checkpointRows(target)).toBe(3);

    await deleteConversation(target, USER);
    expect(await checkpointRows(target)).toBe(0);
    expect(await checkpointRows(sibling)).toBe(3);
  });

  it("permanently deleting a household erases its client's chats and notes in every firm", async () => {
    const { householdId, clientId } = await seedHousehold(FIRM);
    const { clientId: otherClientId } = await seedHousehold(FIRM);
    const ownChat = await seedConversation(FIRM, clientId);
    const recipientChat = await seedConversation(SHARE_FIRM, clientId, OTHER_USER);
    const otherClientChat = await seedConversation(FIRM, otherClientId);
    const globalChat = await seedConversation(FIRM, null);
    await seedNote([FIRM, clientId]);
    await seedNote([SHARE_FIRM, clientId]);
    await seedNote([FIRM, otherClientId]);
    await seedNote([FIRM, USER]);
    await seedNote([SHARE_FIRM, OTHER_USER]);

    await purgeCrmHouseholdById(householdId, FIRM, true);

    expect(await checkpointRows(ownChat)).toBe(0);
    expect(await checkpointRows(recipientChat)).toBe(0);
    expect(await hasNote([FIRM, clientId])).toBe(false);
    expect(await hasNote([SHARE_FIRM, clientId])).toBe(false);
    // Another client's and the advisors' history stays.
    expect(await checkpointRows(otherClientChat)).toBe(3);
    expect(await checkpointRows(globalChat)).toBe(3);
    expect(await hasNote([FIRM, otherClientId])).toBe(true);
    expect(await hasNote([FIRM, USER])).toBe(true);
    expect(await hasNote([SHARE_FIRM, OTHER_USER])).toBe(true);
  });

  it("purging a firm erases every chat and every note under the firm, and no other firm's", async () => {
    const past = new Date("2026-01-01T00:00:00Z");
    await db.insert(firms).values({ firmId: PURGE_FIRM, archivedAt: past, dataRetentionUntil: past });
    const { clientId } = await seedHousehold(PURGE_FIRM);
    const clientChat = await seedConversation(PURGE_FIRM, clientId);
    const globalChat = await seedConversation(PURGE_FIRM, null);
    await seedNote([PURGE_FIRM, clientId]);
    await seedNote([PURGE_FIRM, USER]);
    const prefixFirmChat = await seedConversation(PREFIX_FIRM, null);
    await seedNote([PREFIX_FIRM, USER]);
    await seedNote([WILDCARD_FIRM, USER]);

    await purgeFirmById(PURGE_FIRM);

    expect(await checkpointRows(clientChat)).toBe(0);
    expect(await checkpointRows(globalChat)).toBe(0);
    expect(await hasNote([PURGE_FIRM, clientId])).toBe(false);
    expect(await hasNote([PURGE_FIRM, USER])).toBe(false);
    expect(await checkpointRows(prefixFirmChat)).toBe(3);
    expect(await hasNote([PREFIX_FIRM, USER])).toBe(true);
    expect(await hasNote([WILDCARD_FIRM, USER])).toBe(true);
  });
});
