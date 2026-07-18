import type { Account, ClientData } from "@/engine/types";

/**
 * Audit F13 — every entity needs a default checking account or the projection
 * engine has nowhere to route its cash.
 *
 * Three paths put an entity on the effective tree, and all three must agree:
 *   • the API (`app/api/clients/[id]/entities/route.ts`) inserts a real
 *     `entity_name — Cash` account row per base scenario;
 *   • the live solver (`lib/solver/apply-mutations.ts`, `entity-upsert`)
 *     synthesizes one on the in-memory tree;
 *   • a SAVED scenario persists only a `targetKind: "entity"` change row —
 *     `applyChanges.ts` pushes the entity into `tree.entities` and creates no
 *     account at all. This module is that third path's fix.
 *
 * Without it, `entityCheckingByEntityId` (projection.ts:556-563) has no entry
 * for the entity and every trust payment pass `continue`s: an advisor steers a
 * CRT in the solver, sees payments, saves, reopens — and the saved scenario,
 * which is what reports actually project, makes zero payments.
 *
 * The synthesized account must be INDISTINGUISHABLE from the live solver's, or
 * the projection changes the moment a scenario is saved. `makeEntityCheckingAccount`
 * below is the ONE constructor both in-memory paths call, so "in lockstep" is a
 * property of the code rather than of two hand-maintained literals.
 */

/** Deterministic id, stable across recomputes so repeated loads neither churn
 *  scenario diffs nor stack duplicates. `applyMutations` assigns this id on
 *  entity create and removes exactly it on entity delete. */
export const entityCheckingId = (entityId: string) =>
  `entity-checking-${entityId}`;

/** True for ids this module minted. Exported for downstream consumers that need
 *  to tell a synthesized cash bucket from an advisor-created one; deliberately
 *  not wired into any caller here. */
export const isSyntheticEntityChecking = (id: string) =>
  id.startsWith("entity-checking-");

/**
 * The single source of truth for a synthesized entity checking account.
 *
 * The em dash in the name is U+2014 and is load-bearing: the loader path and
 * the solver path are compared with a deep-equal parity test, and a hyphen on
 * one side changes the projection the moment a scenario is saved.
 *
 * `titlingType` is required on `Account` but deliberately NOT set here, hence
 * the cast. It only distinguishes `jtwros` from `community_property` — both
 * SPOUSAL co-titling forms — and its own doc comment says it is "Ignored for
 * solo-owned or entity-owned accounts; the engine only consults it when
 * `isJointHousehold(a)` is true." The DB/API path
 * (`app/api/clients/[id]/entities/route.ts`) also leaves the column unset, so
 * inventing a value here would introduce a NEW divergence from the third path
 * instead of removing one.
 */
export function makeEntityCheckingAccount(
  entityId: string,
  name?: string,
): Account {
  return {
    id: entityCheckingId(entityId),
    name: `${name ?? "Entity"} — Cash`,
    category: "cash",
    subType: "checking",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "entity", entityId, percent: 1 }],
  } as Account;
}

/** The guard `applyMutations` uses: any default-checking account with this
 *  entity among its owners counts, so an advisor-created cash account is never
 *  duplicated or clobbered. Deliberately looser than the engine's
 *  `isFullyEntityOwned` — matching the live path matters more than tightening
 *  one side of it. */
function hasEntityChecking(
  accounts: ClientData["accounts"],
  entityId: string,
): boolean {
  return accounts.some(
    (a) =>
      a.isDefaultChecking === true &&
      a.owners.some((o) => o.kind === "entity" && o.entityId === entityId),
  );
}

/**
 * Add a default checking account for every entity on the tree that lacks one.
 * Idempotent: the accounts it creates satisfy its own guard, so re-running is a
 * no-op. Returns the SAME tree reference when nothing is missing, which is what
 * makes it safe to drop onto the loader's base-case fast path.
 */
export function withSynthesizedEntityChecking(tree: ClientData): ClientData {
  const missing = (tree.entities ?? []).filter(
    (e) => !hasEntityChecking(tree.accounts, e.id),
  );
  if (missing.length === 0) return tree;

  return {
    ...tree,
    accounts: [
      ...tree.accounts,
      ...missing.map((e) => makeEntityCheckingAccount(e.id, e.name)),
    ],
  };
}
