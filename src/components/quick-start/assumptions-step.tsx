// src/components/quick-start/assumptions-step.tsx
"use client";
import type { QsStepProps } from "./step-props";

export function AssumptionsStep({ registerSave }: QsStepProps) {
  registerSave(async () => {});
  return <p className="text-ink-3">Assumptions step (placeholder).</p>;
}
