"use client";

import { createContext, useContext } from "react";
// Type-only: use-scenario-writer imports `useHeldEdits` as a value.
import type { ScenarioEdit } from "@/hooks/use-scenario-writer";

/**
 * Set by the Solver's editor host around a Details editor. Inside it, nothing
 * writes: `useScenarioWriter` hands the editor's edits to `hold` instead, and
 * the Solver keeps them as unsaved changes.
 */
export interface HeldEdits {
  hold: (edits: ScenarioEdit[]) => Promise<Response>;
}

/** What a write that has no held form says in the Solver. */
export const HOLD_MODE_DIRECT_REFUSAL =
  "This part can't be changed in the Solver. Edit it on the Details page.";

const Ctx = createContext<HeldEdits | null>(null);

export const HeldEditsProvider = Ctx.Provider;

export function useHeldEdits(): HeldEdits | null {
  return useContext(Ctx);
}

/** True inside a Solver-hosted editor: nothing may write. */
export function useHoldMode(): boolean {
  return useHeldEdits() !== null;
}
