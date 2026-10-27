import type { Account } from "@/engine/types";
import type { SolverMutation } from "./types";
import { REVOCABLE_TRUST_ELIGIBLE_CATEGORIES } from "./estate-levers";

/** A revocable living trust as the Estate planning dialog lists it. Revocable
 *  trusts are not entities: an account joins one by carrying its name in
 *  `revocableTrustName`, so a row is just that name plus its members. */
export interface RevocableTrustRow {
  name: string;
  /** Some BASE account carries the name (vs. a name added in this working tree). */
  isBase: boolean;
  /** Members in the WORKING tree. */
  accountIds: string[];
}

/** Trimmed tag; blank or whitespace means "no trust". */
export function revocableTagOf(a: Pick<Account, "revocableTrustName">): string | null {
  return a.revocableTrustName?.trim() || null;
}

/** Two trust names name the same trust: compared trimmed and case-insensitive. */
export function sameTrustName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** One row per distinct trimmed name. A base trust whose accounts were all
 *  unticked still lists (0 accounts); a name added with no accounts does not.
 *  Base rows first, then added, each alphabetical. */
export function revocableTrustRows(
  baseAccounts: Account[],
  workingAccounts: Account[],
): RevocableTrustRow[] {
  const baseNames = new Set<string>();
  for (const a of baseAccounts) {
    const t = revocableTagOf(a);
    if (t) baseNames.add(t);
  }
  const members = new Map<string, string[]>();
  for (const name of baseNames) members.set(name, []);
  for (const a of workingAccounts) {
    const t = revocableTagOf(a);
    if (!t) continue;
    const ids = members.get(t);
    if (ids) ids.push(a.id);
    else members.set(t, [a.id]);
  }
  return [...members]
    .map(([name, accountIds]) => ({ name, isBase: baseNames.has(name), accountIds }))
    .sort((x, y) => Number(y.isBase) - Number(x.isBase) || x.name.localeCompare(y.name));
}

/** Held by a trust entity: an entity-owned slice, or a gift slice naming an
 *  entity (how a gift INTO a trust is titled). Such an account is not the
 *  household's to retitle into a revocable trust, or to leave by will. */
export function isTrustHeld(a: Pick<Account, "owners">): boolean {
  return (a.owners ?? []).some(
    (o) => o.kind === "entity" || (o.kind === "gifted_away" && o.recipient.kind === "entity"),
  );
}

/** Accounts the advisor can tick for a revocable trust: a probate category,
 *  not trust-held, and untagged or already in `trustName`. Sorted by name: a
 *  tick upserts the account, which moves it in the tree's order. */
export function revocableEligibleAccounts(
  accounts: Account[],
  trustName: string | null,
): Account[] {
  const name = trustName?.trim() || null;
  return accounts
    .filter((a) => {
      if (!REVOCABLE_TRUST_ELIGIBLE_CATEGORIES.includes(a.category)) return false;
      if (isTrustHeld(a)) return false;
      const t = revocableTagOf(a);
      return t == null || t === name;
    })
    .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
}

function retag(a: Account, revocableTrustName: string | null): SolverMutation {
  return { kind: "account-upsert", id: a.id, value: { ...a, revocableTrustName } };
}

/** Upserts for the accounts whose tag actually changes: ticked and not yet in
 *  `trustName` get the name; unticked and currently in it get `null`. */
export function buildRevocableMembershipMutations(
  accounts: Account[],
  trustName: string,
  taggedIds: ReadonlySet<string>,
): SolverMutation[] {
  const name = trustName.trim();
  const muts: SolverMutation[] = [];
  for (const a of accounts) {
    const current = revocableTagOf(a);
    if (taggedIds.has(a.id)) {
      if (current !== name) muts.push(retag(a, name));
    } else if (current === name) {
      muts.push(retag(a, null));
    }
  }
  return muts;
}

/** Upserts that move every account tagged `from` to the name `to`. */
export function buildRevocableRenameMutations(
  accounts: Account[],
  from: string,
  to: string,
): SolverMutation[] {
  const f = from.trim();
  const t = to.trim();
  return accounts.filter((a) => revocableTagOf(a) === f).map((a) => retag(a, t));
}
