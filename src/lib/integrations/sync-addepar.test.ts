// src/lib/integrations/sync-addepar.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
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
import { createTestClientWithScenario } from "@/test/factories";
import type { ImportPayload } from "@/lib/imports/types";
import type { ProviderClient } from "./types";
import { createByokConnection } from "./connections";
import { encodeAddeparSecret, encodeAddeparConfig } from "./providers/addepar/credentials";
import { syncConnection } from "./sync";

/** The connection's owner; the syncs below run as a different user ("u1"). */
const OWNER = "owner";

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
  if (firmIds.length === 0) return;
  await db.delete(integrationSyncRuns).where(inArray(integrationSyncRuns.firmId, firmIds));
  // Connections next: their household links cascade with them.
  await db.delete(integrationConnections).where(inArray(integrationConnections.firmId, firmIds));
  // Clients cascade their accounts and imports.
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
  await db.delete(auditLog).where(inArray(auditLog.firmId, firmIds));
});

/**
 * Injected in place of the real Addepar client. Returns the given accounts with
 * one UNTICKERED position each, so resolveHoldingsForCommit short-circuits with
 * zero tickers (no network / classification calls).
 */
function fakeAddeparClient(
  feed: { id: string; name: string; registrationType: string; value: number }[],
): ProviderClient {
  return {
    getHouseholds: async () => [{ id: "hh1", name: "Test HH" }],
    getAccounts: async () => feed,
    getPositions: async () => [{ description: "Cash", units: 1, marketValue: 100 }],
  };
}

const JOINT = { id: "addepar-acct-1", name: "Joint", registrationType: "Joint", value: 1000 };
const BROKERAGE = { id: "addepar-acct-2", name: "Brokerage", registrationType: "Individual", value: 2000 };

/** A connected Addepar household linked on its owner's connection; `linked` are accounts already in the plan. */
async function setUp(linked: { externalId: string; subType: "brokerage" | "trust" }[]) {
  const firmId = freshFirmId();
  const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
  const connectionId = await createByokConnection({
    firmId,
    ownerUserId: OWNER,
    name: "Addepar",
    secretBlob: encodeAddeparSecret({ apiKey: "k", apiSecret: "s" }),
    configBlob: encodeAddeparConfig({ apiBase: "https://api.addepar.com", addeparFirmId: "42" }),
  });
  for (const a of linked) await linkAccount(clientId, scenarioId, a.externalId, a.subType);
  await db.insert(integrationHouseholdLinks).values({
    firmId,
    provider: "addepar",
    connectionId,
    clientId,
    externalHouseholdId: "hh1",
    externalFirmId: "42",
    linkedByUserId: OWNER,
  });
  return { connectionId, clientId, scenarioId };
}

/** The plan account an advisor's review creates for an Addepar account. */
async function linkAccount(clientId: string, scenarioId: string, externalId: string, subType: "brokerage" | "trust") {
  await db.insert(accounts).values({
    clientId,
    scenarioId,
    name: "Reviewed account",
    category: "taxable",
    subType,
    value: "500",
    source: "addepar",
    externalProvider: "addepar",
    externalId,
    deriveFromHoldings: true,
  });
}

const openReviews = (clientId: string) =>
  db
    .select({
      id: clientImports.id,
      createdByUserId: clientImports.createdByUserId,
      payloadJson: clientImports.payloadJson,
    })
    .from(clientImports)
    .where(
      and(
        eq(clientImports.clientId, clientId),
        eq(clientImports.origin, "addepar"),
        eq(clientImports.status, "review"),
      ),
    );

describe("syncConnection — Addepar", () => {
  it("updates a linked account in place and queues only the new one for review", async () => {
    const { connectionId, clientId } = await setUp([{ externalId: JOINT.id, subType: "brokerage" }]);
    const client = fakeAddeparClient([JOINT, BROKERAGE]);

    const res = await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: "u1" });

    expect(res.committed).toBe(1);
    expect(res.queued).toBe(1);
    const [linked] = await db
      .select({ value: accounts.value })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.externalId, JOINT.id)));
    expect(linked.value).toBe("1000.00");

    const reviews = await openReviews(clientId);
    expect(reviews).toHaveLength(1);
    const payload = (reviews[0].payloadJson as { payload?: ImportPayload }).payload;
    expect(payload?.accounts.map((a) => a.externalId)).toEqual([BROKERAGE.id]);
    expect(payload?.accounts[0].match?.kind).toBe("new");
    // Held by the connection's owner, whoever ran the sync, so the owner can open it.
    expect(reviews[0].createdByUserId).toBe(OWNER);
  });

  it("keeps the account type the advisor chose when the feed's guess differs", async () => {
    // "Joint" maps to a brokerage account; the advisor made this one a trust.
    const { connectionId, clientId } = await setUp([{ externalId: JOINT.id, subType: "trust" }]);
    const client = fakeAddeparClient([JOINT]);

    await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: "u1" });

    const [linked] = await db
      .select({ subType: accounts.subType, value: accounts.value })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.externalId, JOINT.id)));
    expect(linked).toEqual({ subType: "trust", value: "1000.00" });
  });

  it("closes the open review once every account in it has been linked", async () => {
    const { connectionId, clientId, scenarioId } = await setUp([]);
    const client = fakeAddeparClient([BROKERAGE]);
    await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: "u1" });
    expect(await openReviews(clientId)).toHaveLength(1);

    await linkAccount(clientId, scenarioId, BROKERAGE.id, "brokerage");
    const res = await syncConnection(connectionId, { trigger: "manual", clientId, client, userId: "u1" });

    expect(res.queued).toBe(0);
    expect(await openReviews(clientId)).toHaveLength(0);
  });
});
