// src/components/quick-start/savings-step.tsx
"use client";
import type { QsSavingsStepProps } from "./step-props";

export function SavingsStep({ registerSave }: QsSavingsStepProps) {
  registerSave(async () => {});
  return <p className="text-ink-3">Savings step (placeholder).</p>;
}
