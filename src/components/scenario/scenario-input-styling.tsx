"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Context that signals whether descendant inputs should render with the
 * scenario-mode "editable" affordance (amber-muted left border).
 *
 * Defaults to `false` so unwrapped trees behave as base mode — i.e. plain
 * inputs with no extra styling. The provider is mounted by
 * `<ScenarioModeWrapper>` once it knows whether a non-base scenario is
 * active in the URL.
 */
const ScenarioInputCtx = createContext<boolean>(false);

/**
 * Returns the className to apply to editable inputs when in scenario mode.
 * Empty string in base mode (no extra styling).
 *
 * Designed to be appended onto an existing `className` so callers don't
 * need to branch on mode at the call site:
 *
 *   const scenarioClass = useScenarioInputClass();
 *   <input className={`${baseClasses} ${scenarioClass}`} />
 */
export function useScenarioInputClass(): string {
  return useContext(ScenarioInputCtx) ? "scenario-editable" : "";
}

/**
 * Provider that flips descendant inputs into scenario-edit styling when
 * `active` is true. Mounted inside `<ScenarioModeWrapper>` reading the
 * current scenarioId from `useScenarioState`.
 */
export function ScenarioInputStyling({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <ScenarioInputCtx.Provider value={active}>
      {children}
    </ScenarioInputCtx.Provider>
  );
}
