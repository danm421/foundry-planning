/**
 * localStorage persistence for the topbar quick CRM note — mirrors the solver
 * draft pattern (src/app/(app)/clients/[id]/solver/use-solver-draft.ts):
 * versioned payload, per-client-per-user key, and "corrupt/blocked storage
 * means no draft" semantics. The draft lives until the advisor saves it to the
 * CRM or explicitly discards it; there is no TTL.
 */

/** Bump when the stored shape changes in a way an older draft can't satisfy. */
const DRAFT_VERSION = 1;
const KEY_PREFIX = "foundry.crmNoteDraft";

interface StoredQuickNoteDraft {
  v: number;
  body: string;
  updatedAt: string;
}

export function quickNoteDraftKey(clientId: string, userId: string): string {
  return `${KEY_PREFIX}:${clientId}:${userId}`;
}

export function readQuickNoteDraft(clientId: string, userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(quickNoteDraftKey(clientId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredQuickNoteDraft | null;
    if (!parsed || parsed.v !== DRAFT_VERSION || typeof parsed.body !== "string") return null;
    return parsed.body;
  } catch {
    return null;
  }
}

export function writeQuickNoteDraft(clientId: string, userId: string, body: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = quickNoteDraftKey(clientId, userId);
    if (!body.trim()) {
      window.localStorage.removeItem(key);
      return;
    }
    const payload: StoredQuickNoteDraft = {
      v: DRAFT_VERSION,
      body,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Quota exceeded / blocked storage — the draft just won't survive nav.
  }
}

export function clearQuickNoteDraft(clientId: string, userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(quickNoteDraftKey(clientId, userId));
  } catch {
    // Blocked storage — nothing to clear.
  }
}

export function hasQuickNoteDraft(clientId: string, userId: string): boolean {
  return readQuickNoteDraft(clientId, userId) !== null;
}
