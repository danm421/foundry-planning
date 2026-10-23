// On/off switches for the Solver's unsaved changes. Pure and client-safe.
import type { ClientData } from "@/engine/types";
import { dependencyClosure, idsCreatedBy, isHeldChange } from "./held-changes";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "./types";

const ESTATE_KINDS: ReadonlySet<SolverMutation["kind"]> = new Set([
  "entity-upsert",
  "will-upsert",
  "gift-upsert",
  "external-beneficiary-upsert",
  "note-receivable-upsert",
  "entity-flow-override-upsert",
  "liability-upsert",
]);

/** Estate-dialog mutations: one switch for the whole "estate" group. */
export function isEstateMutation(m: SolverMutation, all: readonly SolverMutation[]): boolean {
  if (ESTATE_KINDS.has(m.kind)) return true;
  if (m.kind === "account-upsert" || m.kind === "income-upsert" || m.kind === "expense-upsert") {
    if (m.removedRefId) return true;
  }
  if (m.kind !== "account-upsert") return false;
  if (m.value?.owners?.some((o) => o.kind === "entity")) return true;
  return all.some((n) => n.kind === "note-receivable-upsert" && n.sourceAccountId === m.id);
}

/** The switch an entry belongs to. First match wins. */
export function switchGroupOf(m: SolverMutation, all: readonly SolverMutation[], source: ClientData): string {
  if (isHeldChange(m)) return `save:${m.saveId}`;
  if (m.kind === "ss-claim-age" || m.kind === "ss-claim-age-mode") return `ss-claim:${m.person}`;
  if (isEstateMutation(m, all)) return "estate";
  if (m.kind === "savings-rule-upsert" && m.value) {
    const accountId = m.value.accountId;
    const account = all.find((a) => a.kind === "account-upsert" && a.id === accountId);
    if (account && idsCreatedBy(account, source).length > 0) return switchGroupOf(account, all, source);
  }
  return `key:${mutationKey(m)}`;
}

/** Entries that are effectively off: switched-off groups, plus whatever names an id they create. */
export function offEntryKeys(
  all: readonly SolverMutation[],
  offGroups: ReadonlySet<string>,
  source: ClientData,
): Set<SolverMutationKey> {
  if (offGroups.size === 0) return new Set();
  const switchedOff = all.filter((m) => offGroups.has(switchGroupOf(m, all, source)));
  return new Set(dependencyClosure(all, switchedOff, source));
}

/** The unsaved list every projection and save reads: `all` minus the switched-off entries. */
export function effectiveMutations(
  all: readonly SolverMutation[],
  offGroups: ReadonlySet<string>,
  source: ClientData,
): SolverMutation[] {
  if (offGroups.size === 0) return all as SolverMutation[];
  const off = offEntryKeys(all, offGroups, source);
  return all.filter((m) => !off.has(mutationKey(m)));
}

/** An entry's key, then the keys of every entry that depends on what it
 *  creates, however indirectly (the same closure switching it off takes). */
export function removeWithDependants(
  all: readonly SolverMutation[],
  key: SolverMutationKey,
  source: ClientData,
): SolverMutationKey[] {
  const entry = all.find((m) => mutationKey(m) === key);
  if (!entry) return [key];
  return dependencyClosure(all, [entry], source);
}
