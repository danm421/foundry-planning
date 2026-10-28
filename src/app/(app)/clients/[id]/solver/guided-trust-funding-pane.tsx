"use client";

// "＋ Add funding" for a trust that already exists: the wizard's Funding step on
// its own, with this trust as the fixed recipient, and a footer that emits the
// items only on "Add funding". Cancel emits nothing.

import { useMemo, useState } from "react";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import { guidedKindOf, guidedTrustContext, type FundingItem } from "@/lib/solver/guided-trust";
import { buildFundingMutations, fundingItemLabel, fundingTrustOf } from "@/lib/solver/guided-trust-batch";
import type { SolverMutation } from "@/lib/solver/types";
import { GuidedTrustFundingStep } from "./guided-trust-funding-step";
import { focusRing, primaryButton } from "./guided-trust-ui";

interface Props {
  trust: EntitySummary;
  tree: ClientData;
  annualExclusionByYear: Record<number, number>;
  onCancel: () => void;
  onAdd: (mutations: SolverMutation[], fundedOriginals: Account[], labels: string[]) => void;
}

export function GuidedTrustFundingPane({ trust, tree, annualExclusionByYear, onCancel, onAdd }: Props) {
  const [items, setItems] = useState<FundingItem[]>([]);
  const ctx = useMemo(() => guidedTrustContext(tree, annualExclusionByYear), [tree, annualExclusionByYear]);

  const fundingTrust = useMemo(
    () => fundingTrustOf(trust, tree, trust.name?.trim() || "Trust", guidedKindOf(trust)),
    [trust, tree],
  );

  function add() {
    const { mutations, fundedOriginals } = buildFundingMutations(items, trust, tree);
    onAdd(mutations, fundedOriginals, items.map((i) => fundingItemLabel(i, tree)));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-4">
        <GuidedTrustFundingStep trust={fundingTrust} items={items} onItemsChange={setItems} ctx={ctx} />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-hair px-5 py-2.5 text-[13px]">
        <button
          type="button"
          onClick={onCancel}
          className={`rounded-[var(--radius-sm)] px-3.5 py-1.5 text-ink-3 hover:text-ink ${focusRing}`}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={items.length === 0}
          onClick={add}
          className={`${primaryButton} px-3.5 py-1.5`}
        >
          Add funding
        </button>
      </div>
    </div>
  );
}
