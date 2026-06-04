// src/components/quick-start/expenses-step.tsx
"use client";
import type { QsStepProps } from "./step-props";

export function ExpensesStep({ registerSave }: QsStepProps) {
  registerSave(async () => {});
  return <p className="text-ink-3">Expenses step (placeholder).</p>;
}
