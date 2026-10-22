// src/lib/integrations/household-accounts.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accountHoldings,
  accountOwners,
  accounts,
  clientImports,
  clients,
  crmHouseholds,
  familyMembers,
  integrationConnections,
  integrationHouseholdLinks,
} from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { resolveHoldingsForCommit } from "@/lib/imports/commit/holdings";
import { commitTabs } from "@/lib/imports/commit/orchestrator";
import type { ImportPayload } from "@/lib/imports/types";
import { buildReviewAccounts, upsertOpenReview } from "./commit";
import { createByokConnection } from "./connections";
import {
  AccountPanelRefusal,
  addHouseholdAccount,
  connectHouseholdAccount,
  disconnectPlanAccount,
  loadHouseholdAccounts,
} from "./household-accounts";
import { mapToImportPayload } from "./map";
import { encodeAddeparConfig, encodeAddeparSecret } from "./providers/addepar/credentials";
import { ADDEPAR_REGISTRATIONS } from "./providers/addepar/registrations";

const OWNER = "advisor_owner";
const PULLED_AT = new Date("2026-10-20T14:00:00Z");
const EXTERNAL_ID = "addepar-1234";

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
  // Connections first: their household links cascade with them.
  await db.delete(integrationConnections).where(inArray(integrationConnections.firmId, firmIds));
  // Clients cascade their family, accounts (owners, holdings) and imports.
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
});

/**
 * A client (primary member Denise) on an Addepar connection, linked to a
 * household whose last pull holds ONE account: "Fidelity 1234", whose name the
 * registration table doesn't recognise, so it is guessed taxable / brokerage.
 * Its one position is untickered, so committing it needs no price lookups.
 */
async function household() {
  const firmId = freshFirmId();
  const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
  const [denise] = await db
    .insert(familyMembers)
    .values({ clientId, firstName: "Denise", relationship: "other", role: "client" })
    .returning({ id: familyMembers.id });

  const connectionId = await createByokConnection({
    firmId,
    ownerUserId: OWNER,
    name: "Ethos",
    secretBlob: encodeAddeparSecret({ apiKey: "k", apiSecret: "s" }),
    configBlob: encodeAddeparConfig({ apiBase: "https://ethos.addepar.com", addeparFirmId: "42" }),
  });

  const { accounts: pulled } = mapToImportPayload(
    "addepar",
    ADDEPAR_REGISTRATIONS,
    { id: "hh1", name: "" },
    [
      {
        id: EXTERNAL_ID,
        name: "Fidelity 1234",
        registrationType: "Fidelity 1234",
        custodian: "Fidelity",
        accountNumber: "Z0001234",
        value: 50000,
        costBasis: 42000,
      },
    ],
    new Map([[EXTERNAL_ID, [{ description: "Cash", units: 50000, price: 1, marketValue: 50000 }]]]),
  );
  expect(pulled[0]).toMatchObject({ category: "taxable", subType: "brokerage" });

  const [link] = await db
    .insert(integrationHouseholdLinks)
    .values({
      firmId,
      provider: "addepar",
      connectionId,
      clientId,
      externalHouseholdId: "hh1",
      externalFirmId: "42",
      linkedByUserId: OWNER,
      lastPullAccounts: pulled,
      lastPulledAt: PULLED_AT,
    })
    .returning({ id: integrationHouseholdLinks.id });

  const ids = { connectionId, linkId: link.id, providerId: "addepar" as const };
  return { firmId, clientId, scenarioId, deniseId: denise.id, pulled, ids };
}

type Household = Awaited<ReturnType<typeof household>>;

/** Denise's Traditional IRA, owned by her alone, kept by hand (no feed). */
async function deniseIra(h: Household, extra: Partial<typeof accounts.$inferInsert> = {}) {
  const [ira] = await db
    .insert(accounts)
    .values({
      clientId: h.clientId,
      scenarioId: h.scenarioId,
      name: "Denise IRA",
      category: "retirement",
      subType: "traditional_ira",
      custodian: "Schwab",
      accountNumberLast4: "9999",
      value: "31000",
      basis: "0",
      ...extra,
    })
    .returning({ id: accounts.id });
  await db.insert(accountOwners).values({ accountId: ira.id, familyMemberId: h.deniseId, percent: "1.0000" });
  return ira.id;
}

async function loadAccount(id: string) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
  return row;
}

async function ownersOf(accountId: string) {
  return db
    .select({ familyMemberId: accountOwners.familyMemberId, percent: accountOwners.percent })
    .from(accountOwners)
    .where(eq(accountOwners.accountId, accountId));
}

async function reviewPayload(importId: string): Promise<ImportPayload> {
  const [row] = await db
    .select({ payloadJson: clientImports.payloadJson })
    .from(clientImports)
    .where(eq(clientImports.id, importId));
  return (row.payloadJson as { payload: ImportPayload }).payload;
}

describe("loadHouseholdAccounts", () => {
  it("lists the last pull with each account's plan tie, and the untied plan accounts", async () => {
    const h = await household();
    const ira = await deniseIra(h);

    const panel = await loadHouseholdAccounts(h.ids);

    expect(panel).toEqual({
      householdName: "Test Household",
      connectionName: "Ethos",
      pulledAt: PULLED_AT,
      hasSpouse: false,
      rows: [
        {
          externalId: EXTERNAL_ID,
          name: "Fidelity 1234",
          value: 50000,
          guessedCategory: "taxable",
          guessedSubType: "brokerage",
          planAccount: null,
        },
      ],
      candidates: [
        { id: ira, name: "Denise IRA", category: "retirement", subType: "traditional_ira", value: 31000 },
      ],
    });

    await connectHouseholdAccount({ ...h.ids, externalId: EXTERNAL_ID, planAccountId: ira, userId: OWNER });
    const after = await loadHouseholdAccounts(h.ids);
    expect(after?.rows[0].planAccount).toEqual({ id: ira, name: "Denise IRA" });
    // A tied plan account is no longer offered for another Connect.
    expect(after?.candidates).toEqual([]);
  });

  it("is null for a link on another connection", async () => {
    const h = await household();
    const other = await household();
    expect(await loadHouseholdAccounts({ ...h.ids, connectionId: other.ids.connectionId })).toBeNull();
    expect(await loadHouseholdAccounts({ ...h.ids, linkId: "not-a-uuid" })).toBeNull();
  });
});

describe("connectHouseholdAccount", () => {
  it("connect keeps the plan account's type, name and owners and takes Addepar's value", async () => {
    const h = await household();
    const ira = await deniseIra(h);

    await connectHouseholdAccount({ ...h.ids, externalId: EXTERNAL_ID, planAccountId: ira, userId: OWNER });

    const after = await loadAccount(ira);
    // The plan's identity stays: Addepar's "taxable / brokerage" is only a guess.
    expect(after).toMatchObject({
      category: "retirement",
      subType: "traditional_ira",
      name: "Denise IRA",
      custodian: "Schwab",
      accountNumberLast4: "9999",
    });
    expect(await ownersOf(ira)).toEqual([{ familyMemberId: h.deniseId, percent: "1.0000" }]);
    // Addepar's figures and holdings arrive, and the tie is stamped.
    expect(after.value).toBe("50000.00");
    expect(after.basis).toBe("42000.00");
    expect(after).toMatchObject({ externalProvider: "addepar", externalId: EXTERNAL_ID, source: "addepar" });
    expect(after.lastSyncedAt).not.toBeNull();
    const holdings = await db.select().from(accountHoldings).where(eq(accountHoldings.accountId, ira));
    expect(holdings).toHaveLength(1);
    // No second account appeared.
    const all = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.clientId, h.clientId));
    expect(all).toEqual([{ id: ira }]);
  });

  it("refuses a plan account already tied to Addepar", async () => {
    const h = await household();
    const tied = await deniseIra(h, {
      source: "addepar",
      externalProvider: "addepar",
      externalId: "addepar-other",
    });

    await expect(
      connectHouseholdAccount({ ...h.ids, externalId: EXTERNAL_ID, planAccountId: tied, userId: OWNER }),
    ).rejects.toBeInstanceOf(AccountPanelRefusal);

    expect(await loadAccount(tied)).toMatchObject({ externalId: "addepar-other", value: "31000.00" });
  });

  it("refuses an account outside the last pull, and an account already in the plan", async () => {
    const h = await household();
    const ira = await deniseIra(h);
    await expect(
      connectHouseholdAccount({ ...h.ids, externalId: "addepar-gone", planAccountId: ira, userId: OWNER }),
    ).rejects.toBeInstanceOf(AccountPanelRefusal);

    await connectHouseholdAccount({ ...h.ids, externalId: EXTERNAL_ID, planAccountId: ira, userId: OWNER });
    const second = await deniseIra(h, { name: "Denise IRA 2" });
    await expect(
      connectHouseholdAccount({ ...h.ids, externalId: EXTERNAL_ID, planAccountId: second, userId: OWNER }),
    ).rejects.toBeInstanceOf(AccountPanelRefusal);
    await expect(
      addHouseholdAccount({
        ...h.ids,
        externalId: EXTERNAL_ID,
        category: "taxable",
        subType: "brokerage",
        owner: "client",
        userId: OWNER,
      }),
    ).rejects.toBeInstanceOf(AccountPanelRefusal);
  });

  it("rebuilds the open review so committing it doesn't add a second copy", async () => {
    const h = await household();
    const ira = await deniseIra(h);
    const reviewId = await upsertOpenReview({
      clientId: h.clientId,
      firmId: h.firmId,
      scenarioId: h.scenarioId,
      providerId: "addepar",
      ownerUserId: OWNER,
      accounts: buildReviewAccounts({ pulled: h.pulled, ties: [], autoCommitExact: false }),
    });
    expect((await reviewPayload(reviewId)).accounts.map((a) => a.match)).toEqual([{ kind: "new" }]);

    await connectHouseholdAccount({ ...h.ids, externalId: EXTERNAL_ID, planAccountId: ira, userId: OWNER });

    const payload = await reviewPayload(reviewId);
    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0]).toMatchObject({
      externalId: EXTERNAL_ID,
      match: { kind: "exact", existingId: ira },
    });

    // Committing the review now updates the connected account in place.
    await commitTabs({
      importId: reviewId,
      payload,
      tabs: ["accounts"],
      ctx: {
        clientId: h.clientId,
        scenarioId: h.scenarioId,
        orgId: h.firmId,
        userId: OWNER,
        resolvedHoldings: await resolveHoldingsForCommit(payload),
        holdingsAccountIds: [],
      },
    });
    const all = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.clientId, h.clientId));
    expect(all).toEqual([{ id: ira }]);
  });

  it("leaves a client with no open review without one", async () => {
    const h = await household();
    const ira = await deniseIra(h);
    await connectHouseholdAccount({ ...h.ids, externalId: EXTERNAL_ID, planAccountId: ira, userId: OWNER });
    const reviews = await db
      .select({ id: clientImports.id })
      .from(clientImports)
      .where(and(eq(clientImports.clientId, h.clientId), eq(clientImports.status, "review")));
    expect(reviews).toEqual([]);
  });
});

describe("addHouseholdAccount", () => {
  it("add as new uses the chosen type and owner", async () => {
    const h = await household();

    const created = await addHouseholdAccount({
      ...h.ids,
      externalId: EXTERNAL_ID,
      category: "retirement",
      subType: "roth_ira",
      owner: "client",
      userId: OWNER,
    });

    const row = await loadAccount(created);
    expect(row).toMatchObject({
      name: "Fidelity 1234",
      category: "retirement",
      subType: "roth_ira",
      value: "50000.00",
      externalProvider: "addepar",
      externalId: EXTERNAL_ID,
      source: "addepar",
    });
    expect(await ownersOf(created)).toEqual([{ familyMemberId: h.deniseId, percent: "1.0000" }]);
  });
});

describe("disconnectPlanAccount", () => {
  it("disconnect unties but keeps the numbers", async () => {
    const h = await household();
    const ira = await deniseIra(h);
    await connectHouseholdAccount({ ...h.ids, externalId: EXTERNAL_ID, planAccountId: ira, userId: OWNER });

    const removed = await disconnectPlanAccount({ ...h.ids, planAccountId: ira, userId: OWNER });

    expect(removed).toBe(EXTERNAL_ID);
    expect(await loadAccount(ira)).toMatchObject({
      externalProvider: null,
      externalId: null,
      lastSyncedAt: null,
      source: "manual",
      name: "Denise IRA",
      category: "retirement",
      subType: "traditional_ira",
      value: "50000.00",
      basis: "42000.00",
    });
    expect(await ownersOf(ira)).toEqual([{ familyMemberId: h.deniseId, percent: "1.0000" }]);
  });

  it("refuses a plan account that isn't connected to this provider", async () => {
    const h = await household();
    const manual = await deniseIra(h);
    const orion = await deniseIra(h, {
      name: "Orion IRA",
      source: "orion",
      externalProvider: "orion",
      externalId: "orion-1",
    });
    for (const planAccountId of [manual, orion]) {
      await expect(
        disconnectPlanAccount({ ...h.ids, planAccountId, userId: OWNER }),
      ).rejects.toBeInstanceOf(AccountPanelRefusal);
    }
    expect(await loadAccount(orion)).toMatchObject({ externalProvider: "orion", externalId: "orion-1" });
  });
});
