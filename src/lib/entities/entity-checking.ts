import type { ClientData } from "@/engine/types";

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
 * the projection changes the moment a scenario is saved. Keep the shape below
 * in lockstep with the `entity-upsert` branch of `applyMutations`.
 */

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
      ...missing.map(
        (e) =>
          ({
            // Deterministic id, stable across recomputes so repeated loads
            // neither churn scenario diffs nor stack duplicates. Same id
            // `applyMutations` assigns — and removes on entity delete.
            id: `entity-checking-${e.id}`,
            name: `${e.name ?? "Entity"} — Cash`,
            category: "cash",
            subType: "checking",
            value: 0,
            basis: 0,
            growthRate: 0,
            rmdEnabled: false,
            isDefaultChecking: true,
            owners: [{ kind: "entity", entityId: e.id, percent: 1 }],
          }) as ClientData["accounts"][number],
      ),
    ],
  };
}
