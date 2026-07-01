import { useEffect, useRef } from "react";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "@/lib/solver/types";

/**
 * Bump when SolverDraft's serialized shape changes in a way that would make an
 * older draft unsafe to restore. A version mismatch makes readDraft discard the
 * stale draft, so the advisor falls back to a clean source instead of crashing
 * on a mutation shape the current engine no longer understands.
 */
const DRAFT_VERSION = 1;
const KEY_PREFIX = "foundry.solverDraft";

export interface SolverAccountMix {
  assetClassId: string;
  weight: number;
}

/**
 * The persisted slice of solver working state — everything that affects the
 * SAVED output or Monte Carlo correctness. Everything else on screen (the
 * projection, PoS gauge, KPIs) is recomputed from `mutations`, so it isn't
 * stored: `mutations` is the single source of truth.
 */
export interface SolverDraft {
  mutations: SolverMutation[];
  /** Canonical solve seed, so a later Save-as-scenario reproduces the same PoS. */
  solvedSeed: number | null;
  /** MC asset mixes for synthetic min-savings accounts, as [accountId, mix]
   *  entries — a Map isn't JSON-serializable, and the mix lives outside the
   *  mutation so a restored synthetic account would otherwise lose its MC variance. */
  savingsAccountMixes: [string, SolverAccountMix[]][];
}

interface StoredDraft {
  v: number;
  draft: SolverDraft;
}

/**
 * localStorage key — scoped per client, advisor, AND source so a base-case draft
 * never restores onto a scenario (and never bleeds across advisors on a shared
 * workstation, or across clients).
 */
export function solverDraftKey(clientId: string, userId: string, source: string): string {
  return `${KEY_PREFIX}:${clientId}:${userId}:${source}`;
}

function readDraft(key: string): SolverDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft | null;
    if (!parsed || parsed.v !== DRAFT_VERSION || !parsed.draft) return null;
    const d = parsed.draft;
    // An empty mutation set is not a draft worth restoring — nothing to show.
    if (!Array.isArray(d.mutations) || d.mutations.length === 0) return null;
    return {
      mutations: d.mutations,
      solvedSeed: typeof d.solvedSeed === "number" ? d.solvedSeed : null,
      savingsAccountMixes: Array.isArray(d.savingsAccountMixes) ? d.savingsAccountMixes : [],
    };
  } catch {
    // Corrupt JSON, blocked storage, etc. — treat as "no draft".
    return null;
  }
}

/** Rebuild the keyed mutation map the workspace holds in state from a draft's
 *  flat mutation list (last-write-per-lever wins, matching pushMutation). */
export function mutationMapFromDraft(
  mutations: SolverMutation[],
): Map<SolverMutationKey, SolverMutation> {
  const map = new Map<SolverMutationKey, SolverMutation>();
  for (const m of mutations) map.set(mutationKey(m), m);
  return map;
}

export interface UseSolverDraftArgs {
  clientId: string;
  /** Authenticated advisor id. Falsy (e.g. auth not yet resolved) disables
   *  persistence but never blocks the caller's initial Monte Carlo run. */
  userId: string;
  source: string;
  mutations: SolverMutation[];
  solvedSeed: number | null;
  savingsAccountMixes: Map<string, SolverAccountMix[]>;
  onRestore: (draft: SolverDraft) => void;
  /** Fired exactly once after the restore pass (whether or not a draft was
   *  found), so the caller can launch its initial Monte Carlo run knowing any
   *  restored mutations are already applied — avoiding a wasted empty run. */
  onReady: () => void;
}

/**
 * Auto-persists the solver's unsaved working state to localStorage so an advisor
 * returns to a client's solver exactly as they left it — same mutations, solve
 * seed, and synthetic-account mixes — even without having saved a scenario.
 *
 * The draft mirrors the live mutation set: written on every change while there
 * are mutations, and removed the moment the set empties (Reset, or an "Update
 * scenario" that clears the working tree). There is no TTL — it lives until the
 * advisor resolves it (saves it, or resets).
 *
 * Restores once on mount (post-mount, never in a useState initializer, so SSR
 * markup stays stable), then calls `onReady` so the caller can launch its
 * initial Monte Carlo run on the restored mutations rather than firing once
 * empty and again after restore.
 */
export function useSolverDraft({
  clientId,
  userId,
  source,
  mutations,
  solvedSeed,
  savingsAccountMixes,
  onRestore,
  onReady,
}: UseSolverDraftArgs): void {
  const key = userId ? solverDraftKey(clientId, userId, source) : null;
  const restoredRef = useRef(false);

  // Restore the saved draft once, then signal readiness so the caller can kick
  // off its first MC run with any restored mutations already applied. Guard on
  // restoredRef (not just deps) so a StrictMode double-invoke — or an unstable
  // callback identity — can't restore or re-signal twice. Callers pass stable
  // useCallbacks, so in practice this effect's body runs exactly once.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (key) {
      const saved = readDraft(key);
      if (saved) onRestore(saved);
    }
    onReady();
  }, [key, onRestore, onReady]);

  // Persist on every change, but never before the restore pass has run. Write
  // when there are mutations; remove the key when the set empties so a
  // resolved/reset draft leaves no stale trace to restore next time.
  useEffect(() => {
    if (!restoredRef.current || !key) return;
    try {
      if (mutations.length === 0) {
        window.localStorage.removeItem(key);
        return;
      }
      const payload: StoredDraft = {
        v: DRAFT_VERSION,
        draft: {
          mutations,
          solvedSeed,
          savingsAccountMixes: Array.from(savingsAccountMixes.entries()),
        },
      };
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Quota exceeded / blocked storage — the draft just won't survive nav.
    }
  }, [key, mutations, solvedSeed, savingsAccountMixes]);
}
