"use client";

// Confirmation for dissolving a trust, shown in the detail pane rather than as
// a second modal: the estate dialog is already a DialogShell, and stacking one
// destructive confirm on top of another surface buries the consequences.
//
// Every line below is read back off `buildDissolveTrustMutations` — the same
// call that will run on confirm — so the confirmation and the mutations cannot
// disagree. The one exception is the policy count, which the lever does not
// summarise; it is derived from the tree with the ruling's own predicate.

import { useMemo } from "react";
import type { ClientData, EntitySummary } from "@/engine/types";
import { buildDissolveTrustMutations } from "@/lib/solver/trust-levers";

interface RemovalFact {
  key: string;
  prefix: string;
  count: number;
  suffix: string;
}

/**
 * Life-insurance policies naming this trust as a beneficiary.
 *
 * `entityIdRef`, not `entityId`: account and remainder beneficiaries spell the
 * entity reference `entityIdRef`, income beneficiaries spell it `entityId`, and
 * mixing them up drops the reference silently.
 */
function policiesNamingTrust(tree: ClientData, entityId: string): number {
  return tree.accounts.filter(
    (a) =>
      a.category === "life_insurance" &&
      (a.beneficiaries ?? []).some((b) => b.entityIdRef === entityId),
  ).length;
}

/**
 * What dissolving this trust will do, counted off the lever's own mutations.
 *
 * Ownership and beneficiary changes are told apart by ARRAY IDENTITY: the lever
 * builds each replacement as `{ ...account }` and only assigns `owners` /
 * `beneficiaries` when it actually rewrites them, so an unchanged array is the
 * same reference the tree already held. That keeps this free of a second copy
 * of the lever's predicates, which are subtle enough that a copy would drift.
 */
function trustRemovalFacts(tree: ClientData, entity: EntitySummary): RemovalFact[] {
  const muts = buildDissolveTrustMutations(tree, entity);
  const byId = new Map(tree.accounts.map((a) => [a.id, a]));
  let accountsReturned = 0;
  let accountsDropped = 0;
  let liabilities = 0;
  let gifts = 0;
  let wills = 0;
  let entities = 0;

  for (const m of muts) {
    switch (m.kind) {
      case "account-upsert": {
        if (m.value === null) {
          accountsDropped += 1;
          break;
        }
        if (m.value.owners !== byId.get(m.id)?.owners) accountsReturned += 1;
        break;
      }
      case "liability-upsert":
        liabilities += 1;
        break;
      case "gift-upsert":
        gifts += 1;
        break;
      case "will-upsert":
        wills += 1;
        break;
      case "entity-upsert":
        // The trust's own delete is emitted last, as `value: null`.
        if (m.value !== null) entities += 1;
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
    fact("accounts", "Returns ", accountsReturned,
      " account to the household.", " accounts to the household."),
    fact("dropped", "Drops ", accountsDropped,
      " empty trust cash account.", " empty trust cash accounts."),
    fact("policies", "Clears the trust as beneficiary of ",
      policiesNamingTrust(tree, entity.id), " policy.", " policies."),
    fact("liabilities", "Moves ", liabilities,
      " liability back to the household.", " liabilities back to the household."),
    fact("gifts", "Removes ", gifts,
      " planned gift to the trust.", " planned gifts to the trust."),
    fact("wills", "Removes it from ", wills, " will.", " wills."),
    fact("entities", "Clears it from ", entities, " other entity.", " other entities."),
  ].filter((f) => f.count > 0);
}

export function SolverTrustRemoveConfirm({
  trustName,
  entity,
  clientData,
  onCancel,
  onConfirm,
}: {
  trustName: string;
  entity: EntitySummary;
  clientData: ClientData;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const facts = useMemo(
    () => trustRemovalFacts(clientData, entity),
    [clientData, entity],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <h3 className="text-[15px] font-semibold text-ink">Remove {trustName}?</h3>
        <p className="text-[13px] leading-relaxed text-ink-2">
          The trust leaves this scenario along with every reference to it. The
          base plan is untouched until you save the scenario.
        </p>

        <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 py-3">
          {facts.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              Nothing else in the plan refers to this trust.
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
          Keep trust
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-[var(--radius-sm)] border border-crit/50 px-3 py-1.5 text-[13px] font-medium text-crit hover:bg-crit/10"
        >
          Remove trust
        </button>
      </div>
    </div>
  );
}
