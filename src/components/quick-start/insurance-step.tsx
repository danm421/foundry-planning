// src/components/quick-start/insurance-step.tsx
"use client";
import type { QsStepProps } from "./step-props";

export function InsuranceStep({ registerSave }: QsStepProps) {
  registerSave(async () => {});
  return <p className="text-ink-3">Life insurance step (placeholder).</p>;
}
