"use client";

import { createContext, useContext } from "react";

/**
 * Lets a wizard step body report unsaved-edit state up to OnboardingShell so
 * step navigation (Next/Back/Skip/stepper — all soft router.push calls that
 * beforeunload cannot intercept) can confirm before discarding a sandbox.
 * Null outside the onboarding wizard — consumers must no-op when absent.
 */
export interface OnboardingDirtyState {
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
}

export const OnboardingDirtyContext = createContext<OnboardingDirtyState | null>(null);

export function useOnboardingDirty(): OnboardingDirtyState | null {
  return useContext(OnboardingDirtyContext);
}
