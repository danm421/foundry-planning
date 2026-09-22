import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  accountOwners,
  accounts,
  clients,
  crmHouseholdContacts,
  entities,
  familyMembers,
  liabilities,
  scenarios,
} from "@/db/schema";
import type { AccountCandidate } from "@/lib/imports/match-keys/account";
import type { LiabilityCandidate } from "@/lib/imports/match-keys/liability";
import type { OwnerMatchFamilyMember } from "@/lib/imports/owner-match";
import { familyMemberName } from "./owner-options";

/**
 * Everything the statement-chat review table needs about the plan it is
 * committing INTO: who is on the household roster, which entities can hold an
 * account, and which accounts already exist to be matched against.
 *
 * Loaded once by the page (a server component) and handed to the client
 * surface, rather than fetched per-row: the roster drives the Owner dropdown,
 * the accounts drive both the automatic match and the link picker's option
 * list, and all three are small, stable, and needed before the first row
 * renders.
 */
export interface ChatReviewContext {
  familyMembers: OwnerMatchFamilyMember[];
  /** Trusts, LLCs and the rest — anything that can hold an account. */
  entities: { id: string; name: string }[];
  /** Existing accounts in the scenario this import commits to. */
  accounts: AccountCandidate[];
  /**
   * The liabilities already on the plan this import commits into — the Match
   * column's option list on the liabilities table. Empty leaves every row
   * reading "New", the honest answer for a plan with nothing to match.
   */
  liabilities: LiabilityCandidate[];
  /**
   * What the plan already says about the client and spouse, keyed by the SAME
   * `client_household` field keys the Details map declares — the LEFT column of
   * the household diff (`household-diff.ts`).
   *
   * Two sources, because the household's own fields have two homes: identity
   * and contact details live on the CRM household contacts and the PUT mirrors
   * them across (`profile.ts:20-23`), while only the horizon and tax fields are
   * columns on the `clients` row. A left column built from either half alone
   * would show every field of the other half as a disagreement.
   */
  household: Record<string, unknown>;
}

export const EMPTY_CHAT_REVIEW_CONTEXT: ChatReviewContext = {
  familyMembers: [],
  entities: [],
  accounts: [],
  liabilities: [],
  household: {},
};

/**
 * Resolve the scenario an import will actually commit to.
 *
 * Deliberately mirrors `commit/route.ts` (and `match.ts`'s `loadLivingSlots`):
 * an import created from the chat picker with no scenario is `onboarding` mode
 * and lazily resolves to the base case at commit time. The candidate list has to
 * be scoped to the SAME scenario, or the advisor is offered accounts the commit
 * cannot update — a picker whose choices silently do nothing.
 */
async function resolveScenarioId(
  clientId: string,
  scenarioId: string | null,
): Promise<string | null> {
  if (scenarioId) return scenarioId;
  const [base] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  return base?.id ?? null;
}

/**
 * The `clients`-row half of the household's fields — the PUT's own
 * `MUTABLE_CLIENT_FIELDS` allowlist (`api/clients/[id]/route.ts`) minus
 * `planEndAge`, which the map marks `writable: false` because the route
 * recomputes it. Declared once and used BOTH as the select projection and as
 * the keys copied onto the record, so the two cannot drift apart.
 */
const PLAN_COLUMNS = {
  retirementAge: clients.retirementAge,
  retirementMonth: clients.retirementMonth,
  lifeExpectancy: clients.lifeExpectancy,
  spouseRetirementAge: clients.spouseRetirementAge,
  spouseRetirementMonth: clients.spouseRetirementMonth,
  spouseLifeExpectancy: clients.spouseLifeExpectancy,
  filingStatus: clients.filingStatus,
  riskTolerance: clients.riskTolerance,
} as const;

/**
 * The contact columns the household's field map reads, and the key each one
 * occupies on the SPOUSE's side of that map.
 *
 * This is the inverse of `mirrorContactToCrm` (`src/lib/clients/`), which is
 * the only writer of these columns: `spouseName` lands in the spouse contact's
 * `firstName`, `spouseDob` in its `dateOfBirth`, and so on. Written as one
 * table rather than two hand-rolled objects because the asymmetry — the client
 * side keeps the column's own name, the spouse side does not — is exactly what
 * a second copy would get wrong.
 */
const SPOUSE_KEY = {
  firstName: "spouseName",
  lastName: "spouseLastName",
  dateOfBirth: "spouseDob",
  email: "spouseEmail",
  phone: "spousePhone",
  mobile: "spouseMobile",
  addressLine1: "spouseAddressLine1",
  addressLine2: "spouseAddressLine2",
  city: "spouseCity",
  state: "spouseState",
  postalCode: "spousePostalCode",
  country: "spouseCountry",
} as const;

type ContactKey = keyof typeof SPOUSE_KEY;
type ContactRow = { role: string } & Record<ContactKey, unknown>;

/**
 * The household's current values under the `client_household` field keys.
 *
 * `planEndAge` is deliberately absent: the map marks it `writable: false`
 * (it is recomputed server-side), so the diff drops it anyway and carrying it
 * here would only be a value nothing can read.
 */
function buildHouseholdRecord(
  client: Record<string, unknown> | undefined,
  contacts: ContactRow[],
): Record<string, unknown> {
  if (!client) return {};
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(PLAN_COLUMNS)) record[key] = client[key];

  const primary = contacts.find((c) => c.role === "primary");
  const spouse = contacts.find((c) => c.role === "spouse");
  for (const key of Object.keys(SPOUSE_KEY) as ContactKey[]) {
    record[key] = primary?.[key] ?? null;
    record[SPOUSE_KEY[key]] = spouse?.[key] ?? null;
  }

  // The map's two legacy single-line address keys. The PUT routes both into
  // `addressLine1`, so that column is what a document stating `address` would
  // actually overwrite — leaving them undefined would report every extracted
  // `address` as a disagreement with a record that already matches it.
  record.address = record.addressLine1;
  record.spouseAddress = record.spouseAddressLine1;

  return record;
}

/**
 * Load the roster, the entities, and the existing-account candidates.
 *
 * Candidates are loaded whatever the import's mode. `runMatchingPass` skips them
 * in `onboarding` mode because a brand-new plan has nothing to match, but a chat
 * import created without a scenario is ALSO `onboarding`, and that one routinely
 * runs against a client whose plan already has accounts — re-uploading a
 * statement for a household that was set up months ago. Asking the database is
 * how "if there are any" gets answered; an empty result costs one query and
 * annotates every row `new`, which is exactly the old behaviour.
 */
export async function loadChatReviewContext(
  clientId: string,
  scenarioId: string | null,
): Promise<ChatReviewContext> {
  // The `clients` half of the household's own fields, plus the household id the
  // contact read below needs. Paired with the scenario resolve rather than
  // folded into the batch after it: both are inputs to that batch.
  const [resolvedScenarioId, [clientRow]] = await Promise.all([
    resolveScenarioId(clientId, scenarioId),
    db
      .select({ crmHouseholdId: clients.crmHouseholdId, ...PLAN_COLUMNS })
      .from(clients)
      .where(eq(clients.id, clientId)),
  ]);

  const [familyRows, entityRows, accountRows, liabilityRows, ownerRows, contactRows] =
    await Promise.all([
      db
        .select({
          id: familyMembers.id,
          role: familyMembers.role,
          firstName: familyMembers.firstName,
          lastName: familyMembers.lastName,
        })
        .from(familyMembers)
        .where(eq(familyMembers.clientId, clientId)),
      db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(eq(entities.clientId, clientId)),
      resolvedScenarioId
        ? db
            .select({
              id: accounts.id,
              name: accounts.name,
              category: accounts.category,
              accountNumberLast4: accounts.accountNumberLast4,
              custodian: accounts.custodian,
              value: accounts.value,
            })
            .from(accounts)
            .where(
              and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, resolvedScenarioId)),
            )
        : Promise.resolve([]),
      // Same client+scenario scoping as the account query above — an import
      // with no scenario (`resolveScenarioId` found no base case) must not
      // build `eq(liabilities.scenarioId, null)` against a NOT NULL column.
      resolvedScenarioId
        ? db
            .select({ id: liabilities.id, name: liabilities.name, balance: liabilities.balance })
            .from(liabilities)
            .where(
              and(
                eq(liabilities.clientId, clientId),
                eq(liabilities.scenarioId, resolvedScenarioId),
              ),
            )
        : Promise.resolve([]),
      resolvedScenarioId
        ? db
            .select({
              accountId: accountOwners.accountId,
              familyMemberId: accountOwners.familyMemberId,
              entityId: accountOwners.entityId,
            })
            .from(accountOwners)
            .innerJoin(accounts, eq(accounts.id, accountOwners.accountId))
            .where(
              and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, resolvedScenarioId)),
            )
        : Promise.resolve([]),
      // The identity half of the household, scoped to THIS client's own CRM
      // household — the id came from the clients row above, so there is no path
      // from here to another household's contacts.
      clientRow
        ? db
            .select({
              role: crmHouseholdContacts.role,
              firstName: crmHouseholdContacts.firstName,
              lastName: crmHouseholdContacts.lastName,
              dateOfBirth: crmHouseholdContacts.dateOfBirth,
              email: crmHouseholdContacts.email,
              phone: crmHouseholdContacts.phone,
              mobile: crmHouseholdContacts.mobile,
              addressLine1: crmHouseholdContacts.addressLine1,
              addressLine2: crmHouseholdContacts.addressLine2,
              city: crmHouseholdContacts.city,
              state: crmHouseholdContacts.state,
              postalCode: crmHouseholdContacts.postalCode,
              country: crmHouseholdContacts.country,
            })
            .from(crmHouseholdContacts)
            .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId))
        : Promise.resolve([]),
    ]);

  // Ownership read twice out of one pass: `ownerIds` are what `ownerAgreement`
  // SCORES, and they cover family members alone; `ownerNames` are what the link
  // picker SHOWS, and they cover whoever the account is actually titled to.
  // Entities belong on the second list and not the first — "Sharesky Family
  // Trust" is exactly what an advisor needs to see to tell a trust's brokerage
  // account from the couple's own, even though it contributes no family_member
  // id to compare. An external beneficiary resolves to no name on either list
  // and is skipped; `validateOwnersShape` does not accept one as an owner.
  const nameOfFamilyMember = new Map(familyRows.map((f) => [f.id, familyMemberName(f)]));
  const nameOfEntity = new Map(entityRows.map((e) => [e.id, e.name]));
  const ownerIdsByAccount = new Map<string, string[]>();
  const ownerNamesByAccount = new Map<string, string[]>();
  for (const r of ownerRows) {
    if (r.familyMemberId) {
      const ids = ownerIdsByAccount.get(r.accountId);
      if (ids) ids.push(r.familyMemberId);
      else ownerIdsByAccount.set(r.accountId, [r.familyMemberId]);
    }
    const name =
      (r.familyMemberId ? nameOfFamilyMember.get(r.familyMemberId) : undefined) ??
      (r.entityId ? nameOfEntity.get(r.entityId) : undefined);
    if (!name) continue;
    const names = ownerNamesByAccount.get(r.accountId);
    if (!names) ownerNamesByAccount.set(r.accountId, [name]);
    else if (!names.includes(name)) names.push(name);
  }

  return {
    familyMembers: familyRows,
    entities: entityRows,
    accounts: accountRows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      accountNumberLast4: r.accountNumberLast4,
      custodian: r.custodian,
      value: Number(r.value),
      ownerIds: ownerIdsByAccount.get(r.id) ?? [],
      ownerNames: ownerNamesByAccount.get(r.id) ?? [],
    })),
    liabilities: liabilityRows.map((r) => ({
      id: r.id,
      name: r.name,
      balance: Number(r.balance),
    })),
    household: buildHouseholdRecord(clientRow, contactRows),
  };
}
