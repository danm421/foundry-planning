import { useEffect, useRef } from "react";
import type { Dispatch } from "react";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";
import type { LauncherAction, LauncherState } from "./use-launcher-state";

/**
 * Bump when LauncherState's serialized shape changes in a way that would make an
 * older draft unsafe to restore. A version mismatch makes readDraft discard the
 * stale draft so the advisor falls back to the default deck instead of crashing.
 */
const DRAFT_VERSION = 1;
const KEY_PREFIX = "foundry.presentationDraft";

interface StoredDraft {
  v: number;
  state: LauncherState;
}

/** localStorage key — scoped per client AND advisor so drafts never bleed across either. */
export function draftKey(clientId: string, userId: string): string {
  return `${KEY_PREFIX}:${clientId}:${userId}`;
}

function readDraft(key: string): LauncherState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft | null;
    if (!parsed || parsed.v !== DRAFT_VERSION || !parsed.state) return null;
    const state = parsed.state;
    if (!Array.isArray(state.pages)) return null;
    // Drop any pages whose page type no longer exists in the registry. A stale
    // draft referencing a removed page would otherwise crash the row renderer
    // (PRESENTATION_PAGES[pageId] === undefined).
    const pages = state.pages.filter(
      (p) => p && typeof p.pageId === "string" && p.pageId in PRESENTATION_PAGES,
    );
    return { ...state, pages };
  } catch {
    // Corrupt JSON, blocked storage, etc. — treat as "no draft".
    return null;
  }
}

/**
 * Auto-persists the in-progress deck to localStorage so an advisor returns to a
 * client's Presentations tab exactly as they left it — same pages, order,
 * per-page options, scenario, filename, and loaded-template reference.
 *
 * Restores once on mount (before the first save runs, so the restore isn't
 * clobbered by the initial default state), then writes on every subsequent
 * change. Storage is best-effort: if reading or writing fails the deck still
 * works in-memory, it just won't survive navigation that session.
 */
export function useLauncherDraft(
  clientId: string,
  userId: string,
  state: LauncherState,
  dispatch: Dispatch<LauncherAction>,
): void {
  const key = draftKey(clientId, userId);
  const restoredRef = useRef(false);

  // Restore the saved draft once, then mark restore complete so the save effect
  // below is allowed to start writing.
  useEffect(() => {
    const saved = readDraft(key);
    if (saved) dispatch({ type: "hydrate", state: saved });
    restoredRef.current = true;
    // `key` is stable for the component's lifetime; restore exactly once.
  }, [key, dispatch]);

  // Persist on every change, but never before the restore pass has run.
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      const payload: StoredDraft = { v: DRAFT_VERSION, state };
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Quota exceeded / non-serializable options / blocked storage — drop it.
    }
  }, [key, state]);
}
