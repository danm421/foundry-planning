// src/components/quick-start/income-step.tsx
"use client";
import type { QsStepProps } from "./step-props";

export function IncomeStep({ registerSave }: QsStepProps) {
  registerSave(async () => {});
  return <p className="text-ink-3">Income step (placeholder).</p>;
}
