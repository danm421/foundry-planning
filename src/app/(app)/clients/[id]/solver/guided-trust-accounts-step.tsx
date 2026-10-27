"use client";

// Wizard step for a revocable trust: name it and tick the accounts that move
// in. The default name is shown as the field's value when the answers' name is
// blank and is written into the answers on the first interaction here (never
// from an effect); the wizard shell also seeds it before Review.

import {
  defaultTrustName,
  type GuidedTrustAnswers,
  type GuidedTrustContext,
} from "@/lib/solver/guided-trust";
import { revocableEligibleAccounts } from "@/lib/solver/revocable-trust-rows";
import { Callout, StepHeader } from "./guided-trust-ui";
import { RevocableAccountChecklist } from "./solver-revocable-trust-pane";

interface Props {
  answers: GuidedTrustAnswers;
  ctx: GuidedTrustContext;
  onChange: (next: GuidedTrustAnswers) => void;
}

export function GuidedTrustAccountsStep({ answers, ctx, onChange }: Props) {
  const name = answers.name || defaultTrustName(answers, ctx.tree);
  // Only untagged accounts: an existing trust is edited from its own row.
  const eligible = revocableEligibleAccounts(ctx.tree.accounts, null);
  const checked = new Set(answers.revocableAccountIds);

  const toggle = (id: string) => {
    const next = checked.has(id)
      ? answers.revocableAccountIds.filter((x) => x !== id)
      : [...answers.revocableAccountIds, id];
    onChange({ ...answers, name, revocableAccountIds: next });
  };

  return (
    <div>
      <StepHeader title="Which accounts go in?" subtitle="Name the trust and pick the accounts to move into it." />
      <label className="block text-[12px] text-ink-3">
        Trust name
        <input
          type="text"
          value={name}
          onChange={(e) => onChange({ ...answers, name: e.target.value })}
          className="mt-1 block w-full max-w-sm rounded border border-ink-3 bg-card px-2 py-1 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        />
      </label>
      <div className="mb-1.5 mt-3 text-[10.5px] uppercase tracking-[0.12em] text-ink-4">Accounts</div>
      <RevocableAccountChecklist accounts={eligible} checked={checked} onToggle={toggle} />
      <Callout>Accounts skip probate. You keep full control, and they stay in your taxable estate.</Callout>
    </div>
  );
}
