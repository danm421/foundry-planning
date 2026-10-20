"use client";

import { createContext, useContext } from "react";

/**
 * Set by the Solver's editor host when it opens a Details editor with no
 * scenario selected, so the editor's saves write the client's base facts.
 * The editor says so at the top (`BaseFactsNote`, which `DialogShell` and the
 * few editors that draw their own overlay render), and `useScenarioWriter`
 * asks `confirmSave()` before a base write.
 */
export interface BaseFactsEdit {
  /** True to go ahead with a base write. Asks the advisor once per editor. */
  confirmSave: () => boolean;
}

const Ctx = createContext<BaseFactsEdit | null>(null);

export const BaseFactsEditProvider = Ctx.Provider;

export function useBaseFactsEdit(): BaseFactsEdit | null {
  return useContext(Ctx);
}

/** The confirm the Solver's "Save to base facts" button asks, for one editor's saves. */
export const BASE_FACTS_SAVE_CONFIRM =
  "Save this change to the base facts? This updates the client's real plan and every scenario built on it.";

/** What a declined base write answers, so the editor stays open with its edits. */
export const BASE_FACTS_SAVE_DECLINED = "Not saved. The base facts are unchanged.";

/**
 * The line atop a Details editor the Solver opened on the base case; nothing
 * anywhere else. `DialogShell` renders it, so every editor that draws its own
 * overlay must render it too.
 */
export function BaseFactsNote({ className = "" }: { className?: string }) {
  if (!useBaseFactsEdit()) return null;
  return (
    <p
      role="note"
      className={`rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn ${className}`}
    >
      No scenario selected. Saving changes the client&apos;s base facts.
    </p>
  );
}
