"use client";

import { createContext, useContext } from "react";

/**
 * Lets a wizard step body report unsaved-edit state up to OnboardingShell so
 * step navigation (Next/Back/Skip/stepper — all soft router.push calls that
 * beforeunload cannot intercept) can confirm before discarding a sandbox.
 * The context value is the setter itself; the shell keeps the state. Null
 * outside the onboarding wizard — consumers must no-op when absent.
 */
export const OnboardingDirtyContext = createContext<((dirty: boolean) => void) | null>(null);

export function useSetOnboardingDirty(): ((dirty: boolean) => void) | null {
  return useContext(OnboardingDirtyContext);
}
