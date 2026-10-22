// src/lib/integrations/sync-addepar.test.ts
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

/** A connected, linked Addepar household; `linked` are accounts already in the plan. */
async function setUp(linked: { externalId: string; subType: "brokerage" | "trust" }[]) {
  const firmId = freshFirmId();
  const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
  await upsertByokConnection({
    firmId,
    providerId: "addepar",
    secretBlob: encodeAddeparSecret({ apiKey: "k", apiSecret: "s" }),
    configBlob: encodeAddeparConfig({ apiBase: "https://api.addepar.com", addeparFirmId: "42" }),
    userId: "u1",
  });
  for (const a of linked) await linkAccount(clientId, scenarioId, a.externalId, a.subType);
  await linkHousehold({ firmId, providerId: "addepar", clientId, externalHouseholdId: "hh1", userId: "u1" });
  return { firmId, clientId, scenarioId };
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
    .select({ id: clientImports.id, payloadJson: clientImports.payloadJson })
    .from(clientImports)
    .where(
      and(
        eq(clientImports.clientId, clientId),
        eq(clientImports.origin, "addepar"),
        eq(clientImports.status, "review"),
      ),
    );

describe("syncFirm — Addepar", () => {
  it("updates a linked account in place and queues only the new one for review", async () => {
    const { firmId, clientId } = await setUp([{ externalId: JOINT.id, subType: "brokerage" }]);
    const client = fakeAddeparClient([JOINT, BROKERAGE]);

    const res = await syncFirm(firmId, "addepar", { trigger: "manual", clientId, client, userId: "u1" });

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
  });

  it("keeps the account type the advisor chose when the feed's guess differs", async () => {
    // "Joint" maps to a brokerage account; the advisor made this one a trust.
    const { firmId, clientId } = await setUp([{ externalId: JOINT.id, subType: "trust" }]);
    const client = fakeAddeparClient([JOINT]);

    await syncFirm(firmId, "addepar", { trigger: "manual", clientId, client, userId: "u1" });

    const [linked] = await db
      .select({ subType: accounts.subType, value: accounts.value })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.externalId, JOINT.id)));
    expect(linked).toEqual({ subType: "trust", value: "1000.00" });
  });

  it("closes the open review once every account in it has been linked", async () => {
    const { firmId, clientId, scenarioId } = await setUp([]);
    const client = fakeAddeparClient([BROKERAGE]);
    await syncFirm(firmId, "addepar", { trigger: "manual", clientId, client, userId: "u1" });
    expect(await openReviews(clientId)).toHaveLength(1);

    await linkAccount(clientId, scenarioId, BROKERAGE.id, "brokerage");
    const res = await syncFirm(firmId, "addepar", { trigger: "manual", clientId, client, userId: "u1" });

    expect(res.queued).toBe(0);
    expect(await openReviews(clientId)).toHaveLength(0);
  });
});
