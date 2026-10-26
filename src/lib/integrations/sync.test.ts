// src/lib/integrations/sync.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLog,
  clientImports,
  clients,
  crmHouseholds,
  integrationConnections,
  integrationHouseholdLinks,
  integrationSyncRuns,
} from "@/db/schema";
import { encryptSecret } from "@/lib/crypto/secrets";
import { createTestClientWithScenario } from "@/test/factories";
import type { ImportPayload } from "@/lib/imports/types";
import type { ProviderClient, SyncingProviderId } from "./types";
import {
  createByokConnection,
  disconnectConnectionById,
  loadConnection,
  upsertOauthConnection,
} from "./connections";
import { syncConnection } from "./sync";

// Track every firmId we touch so afterAll can clean up deterministically.
const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `org_test_${randomUUID()}`;
  firmIds.push(id);
  return id;
}

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(async () => {
  if (firmIds.length === 0) return;
  await db.delete(integrationSyncRuns).where(inArray(integrationSyncRuns.firmId, firmIds));
  // Connections next: their household links cascade with them.
  await db.delete(integrationConnections).where(inArray(integrationConnections.firmId, firmIds));
  // Clients cascade their accounts and imports.
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
  await db.delete(auditLog).where(inArray(auditLog.firmId, firmIds));
});

const OWNER = "owner";

function orionConnection(firmId: string, ownerUserId = OWNER): Promise<string> {
  return upsertOauthConnection({ firmId, providerId: "orion", ownerUserId, accessToken: "fake" });
}

/** A link row on a connection. Inserted directly until Task 4's linkHouseholdOnConnection exists. */
async function linkOn(input: {
  firmId: string;
  connectionId: string;
  clientId: string;
  providerId?: SyncingProviderId;
  externalHouseholdId?: string;
}) {
  const [row] = await db
    .insert(integrationHouseholdLinks)
    .values({
      firmId: input.firmId,
      provider: input.providerId ?? "orion",
      connectionId: input.connectionId,
      clientId: input.clientId,
      externalHouseholdId: input.externalHouseholdId ?? "hh1",
      linkedByUserId: OWNER,
    })
    .returning();
  return row;
}

/**
 * Injected in place of the real provider client. Returns plain objects matching
 * the mapper's reads. Uses an UNTICKERED position so resolveHoldingsForCommit
 * short-circuits with zero tickers (no network / classification calls). The
 * closures ignore the ProviderClient `ctx`/id args — the fake needs no auth.
 */
function fakeClient(account: {
  id: string;
  name: string;
  registrationType: string;
  value: number;
}): ProviderClient {
  return {
    getHouseholds: async () => [{ id: "hh1", name: "Test HH" }],
    getAccounts: async () => [account],
    getPositions: async () => [{ description: "Cash", units: 1, marketValue: 100 }],
  };
}

const newAccountClient = () =>
  fakeClient({ id: "orion-acct-2", name: "Brokerage", registrationType: "Individual", value: 2000 });

function openReviews(clientId: string) {
  return db
    .select({
      id: clientImports.id,
      createdByUserId: clientImports.createdByUserId,
      payloadJson: clientImports.payloadJson,
    })
    .from(clientImports)
    .where(
      and(
        eq(clientImports.clientId, clientId),
        eq(clientImports.origin, "orion"),
        eq(clientImports.status, "review"),
      ),
    );
}

describe("syncConnection", () => {
  it("EXACT match auto-commits in place and is idempotent", async () => {
    const firmId = freshFirmId();
    const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
    const connectionId = await orionConnection(firmId);

    // Pre-existing orion account (same externalId → exact match).
    await db.insert(accounts).values({
      clientId,
      scenarioId,
      name: "Joint",
      category: "taxable",
      subType: "brokerage",
      value: "500",
      source: "orion",
      externalProvider: "orion",
      externalId: "orion-acct-1",
      deriveFromHoldings: true,
    });

    await linkOn({ firmId, connectionId, clientId });

    const client = fakeClient({
      id: "orion-acct-1",
      name: "Joint",
      registrationType: "Joint",
      value: 1000,
    });

    const first = await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: OWNER });
    expect(first.committed).toBe(1);
    expect(first.queued).toBe(0);

    // The connection's lastSyncedAt is stamped after a successful sync.
    const conn = await loadConnection(connectionId);
    expect(conn?.lastSyncedAt).not.toBeNull();

    // The account was UPDATED in place (value refreshed, lastSyncedAt stamped).
    const afterFirst = await db
      .select({ id: accounts.id, value: accounts.value, lastSyncedAt: accounts.lastSyncedAt })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.externalId, "orion-acct-1")));
    expect(afterFirst).toHaveLength(1);
    // decimal(15,2) round-trips with scale → "1000.00".
    expect(afterFirst[0].value).toBe("1000.00");
    expect(afterFirst[0].lastSyncedAt).not.toBeNull();

    // Re-sync: still exactly one row (no duplicate), still committed.
    const second = await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: OWNER });
    expect(second.committed).toBe(1);
    expect(second.queued).toBe(0);

    const afterSecond = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.externalId, "orion-acct-1")));
    expect(afterSecond).toHaveLength(1);
  });

  it("NEW account lands in a single open review import (deduped on re-sync)", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const connectionId = await orionConnection(firmId);
    await linkOn({ firmId, connectionId, clientId });

    const client = newAccountClient();

    const r = await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: OWNER });
    expect(r.queued).toBe(1);
    expect(r.committed).toBe(0);
    expect(r.importId).toBeTruthy();

    // NEW accounts must NOT be committed.
    const committed = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.externalProvider, "orion")));
    expect(committed).toHaveLength(0);

    // Exactly one open review import, carrying the new account.
    const reviews = await openReviews(clientId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe(r.importId);
    const payload = (reviews[0].payloadJson as { payload?: ImportPayload }).payload;
    expect(payload?.accounts).toHaveLength(1);
    expect(payload?.accounts[0].externalId).toBe("orion-acct-2");
    expect(payload?.accounts[0].match?.kind).toBe("new");

    // Re-sync: still exactly ONE review import (deduped), no new commits.
    const r2 = await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: OWNER });
    expect(r2.committed).toBe(0);
    expect(r2.queued).toBe(1);
    expect(r2.importId).toBe(r.importId);
    expect(await openReviews(clientId)).toHaveLength(1);
  });

  it("stores each household's last pull on its link", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const connectionId = await orionConnection(firmId);
    const link = await linkOn({ firmId, connectionId, clientId });
    expect(link.lastPulledAt).toBeNull();

    await syncConnection(connectionId, {
      trigger: "manual",
      clientId,
      userId: OWNER,
      client: fakeClient({ id: "orion-acct-1", name: "Joint", registrationType: "Joint", value: 1000 }),
    });

    const [after] = await db
      .select({
        lastPullAccounts: integrationHouseholdLinks.lastPullAccounts,
        lastPulledAt: integrationHouseholdLinks.lastPulledAt,
      })
      .from(integrationHouseholdLinks)
      .where(eq(integrationHouseholdLinks.id, link.id));
    expect(after.lastPullAccounts).toHaveLength(1);
    expect(after.lastPullAccounts?.[0].externalId).toBe("orion-acct-1");
    // The stored row is the mapped import row, holdings included.
    expect(after.lastPullAccounts?.[0]).toMatchObject({ name: "Joint", value: 1000 });
    expect(after.lastPullAccounts?.[0].holdings).toHaveLength(1);
    expect(after.lastPulledAt).not.toBeNull();
  });

  it("a cron-started review belongs to the connection owner", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const connectionId = await orionConnection(firmId);
    await linkOn({ firmId, connectionId, clientId });

    const r = await syncConnection(connectionId, { trigger: "cron", client: newAccountClient() });
    expect(r.queued).toBe(1);

    const reviews = await openReviews(clientId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].createdByUserId).toBe(OWNER);
  });

  it("a colleague's client-page sync files the review under the owner", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const connectionId = await orionConnection(firmId);
    await linkOn({ firmId, connectionId, clientId });

    const r = await syncConnection(connectionId, {
      trigger: "manual",
      clientId,
      userId: "colleague",
      client: newAccountClient(),
    });

    const reviews = await openReviews(clientId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe(r.importId);
    expect(reviews[0].createdByUserId).toBe(OWNER);

    const runs = await db
      .select({ connectionId: integrationSyncRuns.connectionId, status: integrationSyncRuns.status })
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.firmId, firmId));
    expect(runs).toEqual([{ connectionId, status: "ok" }]);

    // The colleague stays the actor on the connection's audit row.
    const audits = await db
      .select({ actorId: auditLog.actorId, metadata: auditLog.metadata })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.firmId, firmId),
          eq(auditLog.action, "integration.sync"),
          eq(auditLog.resourceType, "integration_connection"),
          eq(auditLog.resourceId, connectionId),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe("colleague");
    expect(audits[0].metadata).toMatchObject({ connectionId, provider: "orion", queued: 1 });
  });

  it("a refreshed review is handed to the owner, whoever it was filed under before", async () => {
    const firmId = freshFirmId();
    const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
    const connectionId = await orionConnection(firmId);
    await linkOn({ firmId, connectionId, clientId });
    // An open review a past nightly run filed under the system actor.
    const [stale] = await db
      .insert(clientImports)
      .values({
        clientId,
        orgId: firmId,
        scenarioId,
        mode: "updating",
        status: "review",
        createdByUserId: "system:orion-sync",
        origin: "orion",
        payloadJson: { payload: {} },
      })
      .returning({ id: clientImports.id });

    const r = await syncConnection(connectionId, { trigger: "cron", client: newAccountClient() });
    expect(r.importId).toBe(stale.id);

    const reviews = await openReviews(clientId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].createdByUserId).toBe(OWNER);
  });

  it("syncs only the links of the connection it was given", async () => {
    const firmId = freshFirmId();
    const a = await createTestClientWithScenario(firmId);
    const b = await createTestClientWithScenario(firmId);
    const connectionA = await orionConnection(firmId, "owner-a");
    const connectionB = await orionConnection(firmId, "owner-b");
    await linkOn({ firmId, connectionId: connectionA, clientId: a.clientId, externalHouseholdId: "hh-a" });
    const linkB = await linkOn({
      firmId,
      connectionId: connectionB,
      clientId: b.clientId,
      externalHouseholdId: "hh-b",
    });

    const r = await syncConnection(connectionA, { trigger: "cron", client: newAccountClient() });
    expect(r.queued).toBe(1);

    expect(await openReviews(a.clientId)).toHaveLength(1);
    const bImports = await db
      .select({ id: clientImports.id })
      .from(clientImports)
      .where(eq(clientImports.clientId, b.clientId));
    expect(bImports).toHaveLength(0);
    const [bLink] = await db
      .select({ lastPulledAt: integrationHouseholdLinks.lastPulledAt })
      .from(integrationHouseholdLinks)
      .where(eq(integrationHouseholdLinks.id, linkB.id));
    expect(bLink.lastPulledAt).toBeNull();
  });

  it("refuses a connection that is missing, disconnected, Azure or ownerless", async () => {
    const firmId = freshFirmId();
    const opts = { trigger: "manual" as const, userId: OWNER, client: newAccountClient() };

    await expect(syncConnection(randomUUID(), opts)).rejects.toThrow(/not found/);

    const disconnected = await orionConnection(firmId);
    await disconnectConnectionById(disconnected);
    await expect(syncConnection(disconnected, opts)).rejects.toThrow(/disconnected/);

    const [azure] = await db
      .insert(integrationConnections)
      .values({ firmId, provider: "azure_openai", accessTokenEnc: encryptSecret("{}"), status: "connected" })
      .returning({ id: integrationConnections.id });
    await expect(syncConnection(azure.id, opts)).rejects.toThrow("provider_does_not_sync");

    // The old Addepar connect route can still write a row with no owner.
    const ownerless = await createByokConnection({
      firmId,
      ownerUserId: OWNER,
      name: "Ethos",
      secretBlob: JSON.stringify({ apiKey: "k", apiSecret: "s" }),
      configBlob: JSON.stringify({ apiBase: "https://ethos.addepar.com", addeparFirmId: "42" }),
    });
    await db
      .update(integrationConnections)
      .set({ ownerUserId: null })
      .where(eq(integrationConnections.id, ownerless));
    await expect(syncConnection(ownerless, opts)).rejects.toThrow(/no owner/);

    // None of them started a run.
    const runs = await db
      .select({ id: integrationSyncRuns.id })
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.firmId, firmId));
    expect(runs).toHaveLength(0);
  });

  it("scopes existing-account lookup to the syncing provider", async () => {
    const firmId = freshFirmId();
    const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
    const connectionId = await upsertOauthConnection({
      firmId,
      providerId: "schwab",
      ownerUserId: OWNER,
      accessToken: "fake",
    });
    await linkOn({ firmId, connectionId, clientId, providerId: "schwab" });
    // Seed the pre-existing row as Orion-owned, then sync as Schwab. A
    // correctly provider-scoped query filters externalProvider = "schwab", so
    // this Orion row is invisible to it and the incoming account classifies
    // NEW (committed: 0, queued: 1). A regression to a hardcoded "orion"
    // filter would exact-match this seeded row instead and wrongly report
    // committed: 1 — that's the discriminator this test guards.
    await db.insert(accounts).values({
      clientId,
      scenarioId,
      name: "Schwab Brokerage",
      category: "taxable",
      subType: "brokerage",
      externalProvider: "orion",
      externalId: "ext-1",
    });
    const client = fakeClient({ id: "ext-1", name: "Joint Brokerage", registrationType: "Individual", value: 1000 });
    const res = await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: OWNER });
    expect(res.committed).toBe(0);
    expect(res.queued).toBe(1);
  });
});
