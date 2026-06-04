// src/components/quick-start/accounts-step.tsx
"use client";
import type { QsAccountsStepProps } from "./step-props";

export function AccountsStep({ registerSave }: QsAccountsStepProps) {
  registerSave(async () => {});
  return <p className="text-ink-3">Accounts step (placeholder).</p>;
}
