import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { accountOwners, accounts, entities, familyMembers, scenarios } from "@/db/schema";
import type { AccountCandidate } from "@/lib/imports/match-keys/account";
import type { OwnerMatchFamilyMember } from "@/lib/imports/owner-match";

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
}

export const EMPTY_CHAT_REVIEW_CONTEXT: ChatReviewContext = {
  familyMembers: [],
  entities: [],
  accounts: [],
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
  const resolvedScenarioId = await resolveScenarioId(clientId, scenarioId);

  const [familyRows, entityRows, accountRows, ownerRows] = await Promise.all([
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
    resolvedScenarioId
      ? db
          .select({
            accountId: accountOwners.accountId,
            familyMemberId: accountOwners.familyMemberId,
          })
          .from(accountOwners)
          .innerJoin(accounts, eq(accounts.id, accountOwners.accountId))
          .where(
            and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, resolvedScenarioId)),
          )
      : Promise.resolve([]),
  ]);

  const ownerIdsByAccount = new Map<string, string[]>();
  for (const r of ownerRows) {
    // Entity- and external-beneficiary-owned rows have a null familyMemberId
    // and contribute nothing to family-based owner comparison.
    if (!r.familyMemberId) continue;
    const list = ownerIdsByAccount.get(r.accountId);
    if (list) list.push(r.familyMemberId);
    else ownerIdsByAccount.set(r.accountId, [r.familyMemberId]);
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
    })),
  };
}
