"use client";
import { createContext, useContext } from "react";
import type { Walkthrough, WalkStep } from "@/domain/forge/help/catalog";

export type WalkthroughContextValue = {
  active: Walkthrough | null;
  stepIndex: number;
  currentStep: WalkStep | null;
  start: (walkthroughId: string) => void;
  next: () => void;
  exit: () => void;
};

export const WalkthroughContext = createContext<WalkthroughContextValue | null>(null);

export function useWalkthrough(): WalkthroughContextValue {
  const ctx = useContext(WalkthroughContext);
  if (!ctx) throw new Error("useWalkthrough must be used within WalkthroughProvider");
  return ctx;
}
