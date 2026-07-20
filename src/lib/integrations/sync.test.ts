// src/lib/integrations/sync.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clientImports, clients, crmHouseholds, integrationConnections } from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import type { ImportPayload } from "@/lib/imports/types";
import type { ProviderClient } from "./types";
import { getConnection, upsertConnection } from "./connections";
import { linkHousehold } from "./households";
import { syncFirm } from "./sync";

// Track every firmId we touch so afterAll can clean up deterministically.
const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `test_firm_${randomBytes(4).toString("hex")}`;
  firmIds.push(id);
  return id;
}

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(async () => {
  for (const firmId of firmIds) {
    // clientImports has no cascade from clients (clientId cascade DOES exist),
    // but delete clients first → cascades integrationHouseholdLinks + accounts + clientImports.
    const clientRows = await db.select({ id: clients.id }).from(clients).where(eq(clients.firmId, firmId));
    for (const c of clientRows) {
      await db.delete(clients).where(eq(clients.id, c.id));
    }
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firmId));
    await db.delete(integrationConnections).where(eq(integrationConnections.firmId, firmId));
  }
});

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

describe("syncFirm", () => {
  it("EXACT match auto-commits in place and is idempotent", async () => {
    const firmId = freshFirmId();
    const { clientId, scenarioId } = await createTestClientWithScenario(firmId);

    await upsertConnection({ firmId, providerId: "orion", accessToken: "fake", userId: "u1" });

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

    await linkHousehold({ firmId, providerId: "orion", clientId, externalHouseholdId: "hh1", userId: "u1" });

    const client = fakeClient({
      id: "orion-acct-1",
      name: "Joint",
      registrationType: "Joint",
      value: 1000,
    });

    const first = await syncFirm(firmId, "orion", { trigger: "manual", clientId, client, userId: "u1" });
    expect(first.committed).toBe(1);
    expect(first.queued).toBe(0);

    // The connection's lastSyncedAt is stamped after a successful sync.
    const conn = await getConnection(firmId, "orion");
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
    const second = await syncFirm(firmId, "orion", { trigger: "manual", clientId, client, userId: "u1" });
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

    await upsertConnection({ firmId, providerId: "orion", accessToken: "fake", userId: "u1" });
    await linkHousehold({ firmId, providerId: "orion", clientId, externalHouseholdId: "hh1", userId: "u1" });

    const client = fakeClient({
      id: "orion-acct-2",
      name: "Brokerage",
      registrationType: "Individual",
      value: 2000,
    });

    const r = await syncFirm(firmId, "orion", { trigger: "manual", clientId, client, userId: "u1" });
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
    const reviews = await db
      .select({ id: clientImports.id, payloadJson: clientImports.payloadJson })
      .from(clientImports)
      .where(
        and(
          eq(clientImports.clientId, clientId),
          eq(clientImports.origin, "orion"),
          eq(clientImports.status, "review"),
        ),
      );
    expect(reviews).toHaveLength(1);
    const payload = (reviews[0].payloadJson as { payload?: ImportPayload }).payload;
    expect(payload?.accounts).toHaveLength(1);
    expect(payload?.accounts[0].externalId).toBe("orion-acct-2");
    expect(payload?.accounts[0].match?.kind).toBe("new");

    // Re-sync: still exactly ONE review import (deduped), no new commits.
    const r2 = await syncFirm(firmId, "orion", { trigger: "manual", clientId, client, userId: "u1" });
    expect(r2.committed).toBe(0);
    expect(r2.queued).toBe(1);

    const reviews2 = await db
      .select({ id: clientImports.id })
      .from(clientImports)
      .where(
        and(
          eq(clientImports.clientId, clientId),
          eq(clientImports.origin, "orion"),
          eq(clientImports.status, "review"),
        ),
      );
    expect(reviews2).toHaveLength(1);
  });

  it("throws when the firm has no connected Orion connection", async () => {
    const firmId = freshFirmId();
    await expect(syncFirm(firmId, "orion", { trigger: "manual", userId: "u1" })).rejects.toThrow();
  });

  it("scopes existing-account lookup to the syncing provider", async () => {
    const firmId = freshFirmId();
    const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
    await upsertConnection({ firmId, providerId: "orion", accessToken: "fake", userId: "u1" });
    await linkHousehold({ firmId, providerId: "orion", clientId, externalHouseholdId: "hh1", userId: "u1" });
    // An account carrying a DIFFERENT provider's externalId under the SAME base
    // scenario must classify NEW, never as an exact match — otherwise an Orion
    // sync would collide with a Schwab-owned row. syncFirm's existing-account
    // query filters externalProvider = the syncing provider, so this schwab row
    // must be invisible to it.
    await db.insert(accounts).values({
      clientId,
      scenarioId,
      name: "Schwab Brokerage",
      category: "taxable",
      subType: "brokerage",
      externalProvider: "schwab",
      externalId: "ext-1",
    });
    const client = fakeClient({ id: "ext-1", name: "Joint Brokerage", registrationType: "Individual", value: 1000 });
    const res = await syncFirm(firmId, "orion", { trigger: "manual", clientId, client, userId: "u1" });
    expect(res.committed).toBe(0);
    expect(res.queued).toBe(1);
  });
});
