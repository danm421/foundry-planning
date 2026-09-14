"use client";

// Confirmation for removing a charity, shown in the detail pane — the same
// shape, and for the same reason, as the trust removal confirm next door.
//
// EVERY count below is read back off `buildRemoveCharityMutations` — the same
// call that will run on confirm — so the confirmation and the mutations cannot
// disagree. Removing a charity rewrites beneficiary designations, a will and
// planned gifts; a removal that quietly does that is exactly the surprise the
// spec's error-handling section rules out for a trust, and a charity is the
// structurally identical case.

import { useMemo } from "react";
import type { ClientData } from "@/engine/types";
import { buildRemoveCharityMutations } from "@/lib/solver/charity-levers";

interface RemovalFact {
  key: string;
  prefix: string;
  count: number;
  suffix: string;
}

function charityRemovalSummary(tree: ClientData, charityId: string): RemovalFact[] {
  const muts = buildRemoveCharityMutations(tree, charityId);
  const accountsById = new Map(tree.accounts.map((a) => [a.id, a]));

  let policiesCleared = 0;
  let designationsCleared = 0;
  let entitiesCleared = 0;
  let gifts = 0;
  let wills = 0;

  for (const m of muts) {
    switch (m.kind) {
      case "account-upsert":
        // Every account-upsert this lever emits is a designation clear.
        if (accountsById.get(m.id)?.category === "life_insurance") policiesCleared += 1;
        else designationsCleared += 1;
        break;
      case "entity-upsert":
        entitiesCleared += 1;
        break;
      case "gift-upsert":
        gifts += 1;
        break;
      case "will-upsert":
        wills += 1;
        break;
      default:
        break;
    }
  }

  const fact = (
    key: string,
    prefix: string,
    count: number,
    one: string,
    many: string,
  ): RemovalFact => ({ key, prefix, count, suffix: count === 1 ? one : many });

  return [
    fact("policies", "Clears the charity as beneficiary of ", policiesCleared,
      " policy.", " policies."),
    fact("designations", "Removes a beneficiary designation naming the charity from ",
      designationsCleared, " other account.", " other accounts."),
    fact("entities", "Clears it from the beneficiaries of ", entitiesCleared,
      " trust.", " trusts."),
    fact("gifts", "Removes ", gifts,
      " planned gift to the charity.", " planned gifts to the charity."),
    fact("wills", "Removes it from ", wills, " will.", " wills."),
  ].filter((f) => f.count > 0);
}

export function SolverCharityRemoveConfirm({
  charityName,
  charityId,
  clientData,
  onCancel,
  onConfirm,
}: {
  charityName: string;
  charityId: string;
  clientData: ClientData;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const facts = useMemo(
    () => charityRemovalSummary(clientData, charityId),
    [clientData, charityId],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <h3 className="text-[15px] font-semibold text-ink">Remove {charityName}?</h3>
        <p className="text-[13px] leading-relaxed text-ink-2">
          The charity leaves this scenario along with every reference to it. The
          base plan is untouched until you save the scenario.
        </p>

        <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 py-3">
          {facts.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              Nothing else in the plan refers to this charity.
            </p>
          ) : (
            <ul className="space-y-1.5 text-[13px] text-ink-2">
              {facts.map((f) => (
                <li key={f.key} className="flex gap-2">
                  <span aria-hidden="true" className="text-ink-4">
                    ·
                  </span>
                  <span>
                    {f.prefix}
                    <span className="tabular">{f.count}</span>
                    {f.suffix}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-hair px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-card-hover"
        >
          Keep charity
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-[var(--radius-sm)] border border-crit/50 px-3 py-1.5 text-[13px] font-medium text-crit hover:bg-crit/10"
        >
          Remove charity
        </button>
      </div>
    </div>
  );
}
