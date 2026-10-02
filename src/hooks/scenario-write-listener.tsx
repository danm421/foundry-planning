"use client";

import { createContext, useContext } from "react";
import type { FocusKind } from "@/lib/scenario/change-editor-target";

/** One successful scenario write, as `useScenarioWriter` reports it. */
export interface ScenarioWriteEvent {
  targetKind: FocusKind;
  targetId: string | null;
  op: "add" | "edit" | "remove";
}

type Listener = ((e: ScenarioWriteEvent) => void) | null;

const Ctx = createContext<Listener>(null);

/** The Solver's editor host wraps a focus-mode view in this to learn what it wrote. */
export const ScenarioWriteListener = Ctx.Provider;

export function useScenarioWriteListener(): Listener {
  return useContext(Ctx);
}
