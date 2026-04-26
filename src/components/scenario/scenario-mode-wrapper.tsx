"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { CreateScenarioDialog } from "./create-scenario-dialog";
import { ScenarioInputStyling } from "./scenario-input-styling";
import { useScenarioState } from "@/hooks/use-scenario-state";

/**
 * Context value exposed by `<ScenarioModeWrapper>` to descendants.
 *
 * Only `openCreate` is exposed for now — keeping the surface area minimal so
 * future scenario-mode UI (rename, delete, duplicate) can grow this contract
 * deliberately rather than via accreted ad-hoc helpers. If you find yourself
 * wanting to add a method here, prefer a dedicated context for that concern
 * unless it shares the same dialog mounting story.
 */
type ScenarioModeUI = { openCreate: () => void };

const ScenarioModeCtx = createContext<ScenarioModeUI>({
  openCreate: () => {},
});

/**
 * Hook for descendants of `<ScenarioModeWrapper>` to trigger the create-
 * scenario dialog. Returns the default no-op when called outside a wrapper,
 * which means missing-provider bugs fail silently instead of throwing — fine
 * for the chip row (the worst case is a dead button) but worth knowing.
 */
export function useScenarioModeUI(): ScenarioModeUI {
  return useContext(ScenarioModeCtx);
}

/**
 * Mounts at the top of the client layout. Exposes `openCreate` to the chip
 * row (and any future descendant) via context, and keeps the dialog mounted
 * at the bottom of the tree so it can be opened from anywhere within.
 *
 * Scenarios come from the parent server layout's DB query — passed through
 * to the dialog so the "Copy from" select can list non-base scenarios.
 */
export function ScenarioModeWrapper({
  clientId,
  scenarios,
  children,
}: {
  clientId: string;
  scenarios: { id: string; name: string; isBaseCase: boolean }[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openCreate = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);

  return (
    <ScenarioModeCtx.Provider value={{ openCreate }}>
      <InputStylingMount clientId={clientId}>
        {children}
        <CreateScenarioDialog
          clientId={clientId}
          scenarios={scenarios}
          open={open}
          onClose={onClose}
        />
      </InputStylingMount>
    </ScenarioModeCtx.Provider>
  );
}

/**
 * Reads the current scenarioId from the URL (via `useScenarioState`) and
 * activates `<ScenarioInputStyling>` whenever a non-base scenario is
 * selected. Pulled into its own component so the parent doesn't have to
 * subscribe to `useSearchParams()` itself — keeps the wrapper's render
 * surface narrow.
 */
function InputStylingMount({
  clientId,
  children,
}: {
  clientId: string;
  children: ReactNode;
}) {
  const { scenarioId } = useScenarioState(clientId);
  return (
    <ScenarioInputStyling active={scenarioId != null}>
      {children}
    </ScenarioInputStyling>
  );
}
