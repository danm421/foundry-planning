// src/lib/fact-finder/save/__tests__/save-end-to-end-updates.test.ts
//
// Live dev database: the save end to end (Plan 4, Task 20), for a household
// already on the plan as Details leaves it — a fact finder reviewed against the
// live plan (no AI step) and stored as the review route stores it, then saved
// through every real save writer: what the advisor leaves unticked stays as on
// record; a record edited in Details after the review stops the save; the old
// import's defects (a loan saved as the client's alone, a will update wiping
// its provisions) don't happen. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_e2e_updates", orgRole: "org:admin" }),
}));

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, clientImports, crmHouseholdContacts, liabilityOwners, willBequests } from "@/db/schema";
import { createAccountForClient, updateAccountForClient } from "@/lib/clients/accounts-writes";
import { createExternalBeneficiaryForClient } from "@/lib/clients/external-beneficiaries-writes";
import { createFamilyMemberForClient } from "@/lib/clients/family-members-writes";
import { createLiabilityForClient } from "@/lib/clients/liabilities-writes";
import { createWillForClient } from "@/lib/clients/wills-writes";
import { defaultTicks, type ChangeSet, type ChangeTicks, type TargetKind } from "../../change-set";
import { loadFactFinder, writeFactFinder, type FactFinderScope } from "../../persist";
import { buildChangeSet } from "../../placement/build";
import { linkedTo, rowOf, stateWith } from "../../placement/__tests__/fixtures";
import { loadRecordBook } from "../../records/book";
import type { FactFinderState } from "../../types";
import { saveChangeSet } from "../save";
import { unwrap } from "../types";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_e2e_updates";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const NOW = new Date("2026-10-15T12:00:00Z");

interface Reviewed {
  seed: SaveSeed;
  scope: FactFinderScope;
  changeSet: ChangeSet;
  ticks: ChangeTicks;
}

/** `state` on a new import, reviewed against the client's plan (no AI step) and stored with its change list — as the review route does it. */
async function review(seed: SaveSeed, state: FactFinderState): Promise<Reviewed> {
  const [imp] = await db
    .insert(clientImports)
    .values({ clientId: seed.clientId, orgId: FIRM, mode: "onboarding", createdByUserId: SAVE_ACTOR, payloadJson: { factFinder: state } })
    .returning({ id: clientImports.id });
  const scope = { importId: imp.id, clientId: seed.clientId, firmId: FIRM };
  const built = await buildChangeSet({ state, book: await planOf(seed), now: NOW, runLeftovers: async () => null });
  const written = await writeFactFinder(scope, state.version, { ...state, changeSet: { ...built, builtAtVersion: state.version + 1 } }, { keepChangeSet: true });
  return { seed, scope, changeSet: written!.changeSet!, ticks: defaultTicks(written!.changeSet!) };
}

/** The save as the route calls it, with the real writers; no tickers to price. */
const save = (r: Reviewed, ticks: ChangeTicks = r.ticks) =>
  saveChangeSet(
    { scope: r.scope, actorId: SAVE_ACTOR, changeSetVersion: r.changeSet.builtAtVersion, ticks },
    { resolveHoldings: async () => new Map(), now: () => NOW },
  );

const planOf = (seed: SaveSeed) => loadRecordBook(seed.clientId, FIRM, seed.scenarioId);
type Plan = Awaited<ReturnType<typeof planOf>>;

/** The one record of `target` with this label. */
function recordOf(plan: Plan, target: TargetKind, label: string) {
  const found = plan.records[target].filter((r) => r.label === label);
  expect(found, `${target} “${label}”`).toHaveLength(1);
  return found[0];
}

/** Every record of `before` is in `after` as it was, except the records the save wrote. */
function expectUnmoved(before: Plan, after: Plan, written: readonly string[]) {
  for (const [target, records] of Object.entries(before.records)) {
    for (const was of records.filter((r) => !written.includes(r.id))) {
      expect(after.records[target as TargetKind].find((r) => r.id === was.id), `${target} “${was.label}”`).toEqual(was);
    }
  }
}

async function auditOf(seed: SaveSeed): Promise<string[]> {
  const rows = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.clientId, seed.clientId));
  return rows.map((r) => r.action).sort();
}

async function importOf(scope: FactFinderScope) {
  const [row] = await db.select({ status: clientImports.status, committedAt: clientImports.committedAt }).from(clientImports).where(eq(clientImports.id, scope.importId));
  return { ...row, factFinder: await loadFactFinder(scope) };
}

const CLIENT = { ref: "person", role: "client" } as const;
const LAURA = { ref: "person", role: "spouse" } as const;
const JOINT = [{ who: CLIENT, percent: 0.5 }, { who: LAURA, percent: 0.5 }];
const record = (target: TargetKind, id: string) => ({ ref: "record", target, id });

/**
 * Mark and Laura, as Details leaves them: Emma and Lucas, a charity, a brokerage account and a car loan
 * Mark owns alone, and Mark's will — the brokerage to Emma, the household cash to Lucas, the rest to
 * Laura. Made through the Details write paths, then the audit rows they left cleared.
 */
async function existingHousehold() {
  const seed = await seedSaveClient(FIRM, { coClient: true });
  const core = { clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR };
  const child = async (firstName: string) =>
    unwrap(await createFamilyMemberForClient({ ...core, input: { firstName, lastName: "Hendricks", relationship: "child", dateOfBirth: "2004-05-01" } })).resourceId;
  const emma = await child("Emma");
  const lucas = await child("Lucas");
  const redCross = unwrap(await createExternalBeneficiaryForClient({ clientId: seed.clientId, input: { name: "American Red Cross" } })).resourceId;
  const markAlone = [{ kind: "family_member", familyMemberId: seed.clientMemberId, percent: 1 }];
  const schwab = unwrap(
    await createAccountForClient({ ...core, input: { name: "Schwab Brokerage", category: "taxable", subType: "brokerage", value: 80000, owners: markAlone } }),
  ).resourceId;
  const carLoan = unwrap(
    await createLiabilityForClient({ ...core, input: { name: "Car loan", balance: 20000, interestRate: 0.05, startYear: 2024, termMonths: 60, owners: markAlone } }),
  ).resourceId;
  const cash = recordOf(await planOf(seed), "account", "Household Cash").id;
  const provision = (name: string, accountId: string, to: string, sortOrder: number) => ({
    kind: "asset", name, assetMode: "specific", accountId, percentage: 100, condition: "always", sortOrder,
    recipients: [{ recipientKind: "family_member", recipientId: to, percentage: 100, sortOrder: 0 }],
  });
  unwrap(
    await createWillForClient({
      ...core,
      input: {
        grantor: "client",
        bequests: [provision("Schwab Brokerage", schwab, emma, 0), provision("Household Cash", cash, lucas, 1)],
        residuaryRecipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
      },
    }),
  );
  await db.delete(auditLog).where(eq(auditLog.clientId, seed.clientId));
  return { seed, core, emma, lucas, redCross, schwab, carLoan };
}

d("the save end to end — a household on the plan (live DB)", () => {
  // Clearing a firm of its households can outlast the default hook timeout on a cold dev branch.
  beforeAll(async () => dropSaveFirm(FIRM), 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it("an unticked name and owner stay as on record; a blank co-client first name never reaches the profile; a new IRA's blank contingent tier keeps its default", async () => {
    const h = await existingHousehold();
    const before = await planOf(h.seed);
    const r = await review(
      h.seed,
      stateWith({
        people: [
          rowOf("people:Client", { retirementAge: 64 }),
          rowOf("people:Co-client", { firstName: null, retirementAge: 66, email: "laura@example.com" }),
        ],
        taxable: [rowOf("tx1", { accountName: "Schwab Joint Brokerage", currentValue: 95000, owner: "Joint" }, { link: linkedTo(h.schwab) })],
        retirement: [rowOf("r1", { accountName: "Mark's Rollover IRA", currentValue: 300000, owner: "Client", accountType: "Traditional IRA", primaryBeneficiary: "American Red Cross" })],
      }),
    );
    expect(r.changeSet.lines.find((l) => l.id === "people:Co-client/client_household")?.fields.map((f) => f.key)).toEqual(["spouseRetirementAge", "spouseEmail"]);
    // A name or owner that would replace the one on record starts unticked; the advisor leaves them so.
    expect(r.ticks["tx1/account"]).toEqual({ name: false, value: true, owners: false });
    expect((await save(r)).ok).toBe(true);

    const plan = await planOf(h.seed);
    expect(recordOf(plan, "client_household", "Mark Hendricks").values).toMatchObject({
      retirementAge: 64, spouseName: "Laura", spouseLastName: "Hendricks", spouseRetirementAge: 66, spouseEmail: "laura@example.com",
    });
    const contacts = await db.select({ role: crmHouseholdContacts.role, firstName: crmHouseholdContacts.firstName }).from(crmHouseholdContacts).where(eq(crmHouseholdContacts.householdId, h.seed.householdId));
    expect(contacts.sort((a, b) => a.role.localeCompare(b.role))).toEqual([{ role: "primary", firstName: "Mark" }, { role: "spouse", firstName: "Laura" }]);
    expect(plan.people).toEqual(before.people);

    // Only the ticked value changed.
    expect(recordOf(plan, "account", "Schwab Brokerage").values).toEqual({ ...recordOf(before, "account", "Schwab Brokerage").values, value: 95000 });

    // The fact finder names the primary beneficiary only: the new IRA's default contingent tier — the children — stays.
    const ira = recordOf(plan, "account", "Mark's Rollover IRA").id;
    expect(recordOf(plan, "account_beneficiary_designation", "Mark's Rollover IRA").values.beneficiaries).toEqual([
      { tier: "primary", who: record("external_beneficiary", h.redCross), percentage: 100 },
      { tier: "contingent", who: record("family_member", h.emma), percentage: 50 },
      { tier: "contingent", who: record("family_member", h.lucas), percentage: 50 },
    ]);

    expectUnmoved(before, plan, [h.seed.clientId, h.schwab, ira]);
    expect(await auditOf(h.seed)).toEqual(["account.create", "account.update", "client.update", "client.update", "import.fact_finder_saved"]);
  });

  it("a record edited in Details after the review → 409 naming it; nothing written, the edit kept, the import open", async () => {
    const h = await existingHousehold();
    const r = await review(
      h.seed,
      stateWith({
        people: [rowOf("people:Client", { retirementAge: 64 })],
        cash: [rowOf("c1", { accountName: "Joint Savings", currentValue: 25000, owner: "Joint" })],
        taxable: [rowOf("tx1", { accountName: "Schwab Brokerage", currentValue: 95000 }, { link: linkedTo(h.schwab) })],
      }),
    );
    // The Details PUT, between the review and the save.
    unwrap(await updateAccountForClient({ ...h.core, accountId: h.schwab, input: { value: 82000 } }));
    const edited = await planOf(h.seed);

    expect(await save(r)).toEqual({ ok: false, status: 409, error: "“Schwab Brokerage” changed since you reviewed — review again.", lineId: "tx1/account" });
    expect(await planOf(h.seed)).toEqual(edited);
    expect(recordOf(edited, "account", "Schwab Brokerage").values.value).toBe(82000);
    expect(await auditOf(h.seed)).toEqual(["account.update"]);
    const imp = await importOf(r.scope);
    expect(imp).toMatchObject({ status: "draft", committedAt: null });
    expect(imp.factFinder?.closed).toBeUndefined();
    expect(imp.factFinder?.changeSet).toEqual(r.changeSet);
  });

  it("the old import's defects don't happen: loans are owned by both as the fact finder says; a will update keeps the provision it doesn't list", async () => {
    const h = await existingHousehold();
    const before = await planOf(h.seed);
    const willBefore = await db.select({ id: willBequests.id, name: willBequests.name, sortOrder: willBequests.sortOrder }).from(willBequests).orderBy(asc(willBequests.sortOrder)).where(eq(willBequests.willId, recordOf(before, "will", "Mark's will").id));
    const r = await review(
      h.seed,
      stateWith({
        cash: [rowOf("c1", { accountName: "Joint Savings", currentValue: 25000, owner: "Joint" })],
        liab: [
          rowOf("l1", { loanName: "Car loan", owner: "Joint" }, { link: linkedTo(h.carLoan) }),
          rowOf("l2", { loanName: "Home equity line", type: "HELOC", owner: "Joint", balance: 40000, interestRate: 7, loanStart: "2025-01", termYears: 10 }),
        ],
        bequests: [
          rowOf("bq1", { willOf: "Client", gift: "Specific asset", asset: "Schwab Brokerage", recipients: "Emma 50%, Lucas 50%", condition: "Always" }),
          rowOf("bq2", { willOf: "Client", gift: "Specific asset", asset: "Joint Savings", recipients: "American Red Cross" }),
        ],
      }),
    );
    expect(r.changeSet.lines.map((l) => [l.id, l.action])).toEqual([
      ["c1/account", "create"], ["l1/liability", "update"], ["l2/liability", "create"], ["bq1/will_bequest", "update"], ["bq2/will_bequest", "create"],
    ]);
    // An owner that would replace the one on record starts unticked: the advisor ticks it.
    expect(r.ticks["l1/liability"]).toEqual({ owners: false });
    expect((await save(r, { ...r.ticks, "l1/liability": { owners: true } })).ok).toBe(true);

    const plan = await planOf(h.seed);
    const heloc = recordOf(plan, "liability", "Home equity line");
    // The owners-only update changes the owners and nothing else.
    expect(recordOf(plan, "liability", "Car loan").values).toEqual({ ...recordOf(before, "liability", "Car loan").values, owners: JOINT });
    expect(heloc.values).toMatchObject({ liabilityType: "heloc", balance: 40000, owners: JOINT });
    for (const id of [h.carLoan, heloc.id]) {
      const owners = await db.select({ familyMemberId: liabilityOwners.familyMemberId, percent: liabilityOwners.percent }).from(liabilityOwners).where(eq(liabilityOwners.liabilityId, id));
      expect(owners.sort((a, b) => (a.familyMemberId === h.seed.clientMemberId ? -1 : b.familyMemberId === h.seed.clientMemberId ? 1 : 0))).toEqual([
        { familyMemberId: h.seed.clientMemberId, percent: "0.5000" },
        { familyMemberId: h.seed.spouseMemberId, percent: "0.5000" },
      ]);
    }

    // The listed provision updated in place, the unlisted one kept, the new one after the will's own.
    const will = recordOf(plan, "will", "Mark's will").id;
    const provisions = await db.select({ id: willBequests.id, name: willBequests.name, sortOrder: willBequests.sortOrder }).from(willBequests).orderBy(asc(willBequests.sortOrder)).where(eq(willBequests.willId, will));
    expect(provisions).toEqual([...willBefore, { id: expect.any(String), name: "Joint Savings", sortOrder: 2 }]);
    expect(recordOf(plan, "will_bequest", "Schwab Brokerage").values).toEqual({
      ...recordOf(before, "will_bequest", "Schwab Brokerage").values,
      recipients: [
        { who: record("family_member", h.emma), percentage: 50 },
        { who: record("family_member", h.lucas), percentage: 50 },
      ],
    });
    expect(recordOf(plan, "will_bequest", "Joint Savings").values).toMatchObject({
      accountId: record("account", recordOf(plan, "account", "Joint Savings").id), recipients: [{ who: record("external_beneficiary", h.redCross), percentage: 100 }],
    });

    expectUnmoved(before, plan, [h.carLoan, willBefore[0].id]);
    // As in Details, a loan's owners aren't in its audit snapshot: the owner-only update leaves no row.
    expect(await auditOf(h.seed)).toEqual(["account.create", "import.fact_finder_saved", "liability.create", "will.update", "will.update"]);
  });
});
