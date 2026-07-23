// src/lib/integrations/sync-review-mode.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clientImports, clients, crmHouseholds, integrationConnections } from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import type { ImportPayload } from "@/lib/imports/types";
import type { ProviderClient } from "./types";
import { upsertByokConnection } from "./connections";
import { encodeAddeparSecret, encodeAddeparConfig } from "./providers/addepar/credentials";
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
 * Injected in place of the real Addepar client. Returns TWO accounts: one that
 * exact-matches a pre-seeded account by externalId, and one that is brand new.
 * Uses an UNTICKERED position so resolveHoldingsForCommit short-circuits with
 * zero tickers (no network / classification calls).
 */
function fakeAddeparClient(): ProviderClient {
  return {
    getHouseholds: async () => [{ id: "hh1", name: "Test HH" }],
    getAccounts: async () => [
      { id: "addepar-acct-1", name: "Joint", registrationType: "Joint", value: 1000 },
      { id: "addepar-acct-2", name: "Brokerage", registrationType: "Individual", value: 2000 },
    ],
    getPositions: async () => [{ description: "Cash", units: 1, marketValue: 100 }],
  };
}

describe("syncFirm — review-mode provider (autoCommitExact: false)", () => {
  it("Addepar queues exact+new into ONE review import and auto-commits nothing", async () => {
    const firmId = freshFirmId();
    const { clientId, scenarioId } = await createTestClientWithScenario(firmId);

    await upsertByokConnection({
      firmId,
      providerId: "addepar",
      secretBlob: encodeAddeparSecret({ apiKey: "k", apiSecret: "s" }),
      configBlob: encodeAddeparConfig({ apiBase: "https://api.addepar.com", addeparFirmId: "42" }),
      userId: "u1",
    });

    // Pre-existing Addepar account (same externalId → exact match).
    await db.insert(accounts).values({
      clientId,
      scenarioId,
      name: "Joint",
      category: "taxable",
      subType: "brokerage",
      value: "500",
      source: "addepar",
      externalProvider: "addepar",
      externalId: "addepar-acct-1",
      deriveFromHoldings: true,
    });

    await linkHousehold({ firmId, providerId: "addepar", clientId, externalHouseholdId: "hh1", userId: "u1" });

    const client = fakeAddeparClient();

    const res = await syncFirm(firmId, "addepar", { trigger: "manual", clientId, client, userId: "u1" });

    expect(res.committed).toBe(0);
    expect(res.queued).toBe(2);
    expect(res.importId).toBeTruthy();

    // Nothing was auto-committed — no committed clientImports row, and the
    // pre-seeded account's value is untouched (review mode writes nothing).
    const committedImports = await db
      .select({ id: clientImports.id })
      .from(clientImports)
      .where(and(eq(clientImports.clientId, clientId), eq(clientImports.status, "committed")));
    expect(committedImports).toHaveLength(0);

    const seeded = await db
      .select({ value: accounts.value })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.externalId, "addepar-acct-1")));
    expect(seeded).toHaveLength(1);
    expect(seeded[0].value).toBe("500.00");

    // Exactly ONE open review import, carrying BOTH accounts with the right match kinds.
    const reviews = await db
      .select({ id: clientImports.id, payloadJson: clientImports.payloadJson })
      .from(clientImports)
      .where(
        and(
          eq(clientImports.clientId, clientId),
          eq(clientImports.origin, "addepar"),
          eq(clientImports.status, "review"),
        ),
      );
    expect(reviews).toHaveLength(1);
    const payload = (reviews[0].payloadJson as { payload?: ImportPayload }).payload;
    expect(payload?.accounts).toHaveLength(2);

    const exactRow = payload?.accounts.find((a) => a.externalId === "addepar-acct-1");
    const newRow = payload?.accounts.find((a) => a.externalId === "addepar-acct-2");
    expect(exactRow?.match?.kind).toBe("exact");
    expect(newRow?.match?.kind).toBe("new");
  });
});
