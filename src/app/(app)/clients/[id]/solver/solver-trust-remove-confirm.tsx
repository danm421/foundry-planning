"use client";

// Confirmation for dissolving a trust, shown in the detail pane rather than as
// a second modal: the estate dialog is already a DialogShell, and stacking one
// destructive confirm on top of another surface buries the consequences.
//
// EVERY count below is read back off `buildDissolveTrustMutations` — the same
// call that will run on confirm — so the confirmation and the mutations cannot
// disagree. Nothing here re-walks the tree with a predicate of its own: the
// lever's predicates are subtle (a `gifted_away` slice counts as trust-owned, a
// funded default-checking account comes home with the flag cleared, an emptied
// bequest is dropped) and a second copy drifts silently. The one thing the
// mutations cannot tell us is WHO the assets land on, so that single resolution
// is mirrored below — and pinned by a test that asserts the name on screen and
// the `owners` the lever writes in the same breath.

import { useMemo } from "react";
import type { ClientData, EntitySummary } from "@/engine/types";
import { buildDissolveTrustMutations } from "@/lib/solver/trust-levers";

interface RemovalFact {
  key: string;
  prefix: string;
  count: number;
  suffix: string;
}

interface RemovalSummary {
  facts: RemovalFact[];
  /** Set only when the destination was a fallback AND something actually moves
   *  to it — the confirmation must never say assets return to someone when no
   *  line returns anything. */
  fallbackNote: string | null;
}

interface Heir {
  /** The person's own name. Never a role word: advisor copy says "Co-client",
   *  never "spouse", and naming the person sidesteps the question. */
  name: string;
  /** Why this person, when they were not the recorded grantor. */
  fallback: string | null;
}

/**
 * Where a dissolved trust's assets land, and whether that was a fallback.
 *
 * Mirrors `resolveGrantorFamilyMemberId` in `lib/solver/trust-levers.ts`, which
 * is module-private. A third-party trust records no grantor at all
 * (`EntitySummary.grantor` is optional, and its doc comment says undefined means
 * the trust was funded by a third party), and a recorded grantor can name a role
 * no family member fills. The lever falls back to the primary client in both
 * cases; the spec says the confirmation has to say so rather than guess quietly.
 */
function resolveHeir(tree: ClientData, entity: EntitySummary): Heir {
  const members = tree.familyMembers ?? [];
  const recorded = entity.grantor
    ? members.find((m) => m.role === entity.grantor)
    : undefined;
  const fm = recorded ?? members.find((m) => m.role === "client");
  if (!fm) throw new Error("no primary client family member");
  const name = `${fm.firstName ?? ""} ${fm.lastName ?? ""}`.trim() || "the household";

  if (recorded) return { name, fallback: null };
  return {
    name,
    fallback: entity.grantor
      ? `The grantor recorded on this trust is not on this household, so what it holds returns to ${name}, the primary client.`
      : `This trust has no grantor on file, so what it holds returns to ${name}, the primary client.`,
  };
}

/**
 * What dissolving this trust will do, counted off the lever's own mutations.
 *
 * Ownership changes and reference clears are told apart by ARRAY IDENTITY: the
 * lever builds each replacement as `{ ...original }` and assigns `owners` /
 * `beneficiaries` only when it actually rewrites them, each time from a freshly
 * allocated array. So an untouched array is the very reference the tree already
 * held, and a changed one is never equal by identity. That distinction is what
 * separates a business changing hands from a cross-reference tidy-up, and a
 * retirement account losing its beneficiary designation from a policy losing
 * one.
 */
function trustRemovalSummary(tree: ClientData, entity: EntitySummary): RemovalSummary {
  const muts = buildDissolveTrustMutations(tree, entity);
  const heir = resolveHeir(tree, entity);
  const accountsById = new Map(tree.accounts.map((a) => [a.id, a]));
  const entitiesById = new Map((tree.entities ?? []).map((e) => [e.id, e]));

  let accountsReturned = 0;
  let accountsDropped = 0;
  let policiesCleared = 0;
  let designationsCleared = 0;
  let liabilities = 0;
  let businessesMoved = 0;
  let entityRefsCleared = 0;
  let gifts = 0;
  let wills = 0;

  for (const m of muts) {
    switch (m.kind) {
      case "account-upsert": {
        if (m.value === null) {
          accountsDropped += 1;
          break;
        }
        const original = accountsById.get(m.id);
        if (m.value.owners !== original?.owners) accountsReturned += 1;
        if (m.value.beneficiaries !== original?.beneficiaries) {
          // A see-through trust named on a retirement account is the standard
          // pattern; folding it into the policy count hid it completely.
          if (original?.category === "life_insurance") policiesCleared += 1;
          else designationsCleared += 1;
        }
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
      case "entity-upsert": {
        // The trust's own delete is emitted last, as `value: null`.
        if (m.value === null) break;
        const original = entitiesById.get(m.id);
        // A business the trust holds changes hands; a trust that merely named
        // this one loses a reference. Both can be true of one entity.
        if (m.value.owners !== original?.owners) businessesMoved += 1;
        if (
          m.value.beneficiaries !== original?.beneficiaries ||
          m.value.remainderBeneficiaries !== original?.remainderBeneficiaries ||
          m.value.incomeBeneficiaries !== original?.incomeBeneficiaries
        ) {
          entityRefsCleared += 1;
        }
        break;
      }
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

  const facts = [
    // What changes hands, first.
    fact("accounts", "Returns ", accountsReturned,
      ` account to ${heir.name}.`, ` accounts to ${heir.name}.`),
    fact("liabilities", "Moves ", liabilities,
      ` liability back to ${heir.name}.`, ` liabilities back to ${heir.name}.`),
    fact("businesses", "Transfers ownership of ", businessesMoved,
      ` business to ${heir.name}.`, ` businesses to ${heir.name}.`),
    // Then what is cleared.
    fact("dropped", "Drops ", accountsDropped,
      " empty trust cash account.", " empty trust cash accounts."),
    fact("policies", "Clears the trust as beneficiary of ", policiesCleared,
      " policy.", " policies."),
    fact("designations", "Removes a beneficiary designation naming the trust from ",
      designationsCleared, " other account.", " other accounts."),
    fact("gifts", "Removes ", gifts,
      " planned gift to the trust.", " planned gifts to the trust."),
    fact("wills", "Removes it from ", wills, " will.", " wills."),
    fact("entities", "Clears it from ", entityRefsCleared,
      " other entity.", " other entities."),
  ].filter((f) => f.count > 0);

  const moves = accountsReturned + liabilities + businessesMoved > 0;
  return { facts, fallbackNote: moves ? heir.fallback : null };
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
  // The lever throws on a household with no primary client to return assets to —
  // the only throw it has. Computed at render, that throw would unmount the
  // whole modal behind an "Application error" that hides the stack. Catching it
  // makes the same data problem louder, not quieter: a sentence that says what
  // is wrong, and a Remove button that will not fire.
  const summary = useMemo<RemovalSummary | null>(() => {
    try {
      return trustRemovalSummary(clientData, entity);
    } catch {
      return null;
    }
  }, [clientData, entity]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <h3 className="text-[15px] font-semibold text-ink">Remove {trustName}?</h3>
        <p className="text-[13px] leading-relaxed text-ink-2">
          The trust leaves this scenario along with every reference to it. The
          base plan is untouched until you save the scenario.
        </p>

        {summary === null ? (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] border border-crit/50 bg-crit/10 px-4 py-3 text-[13px] leading-relaxed text-crit"
          >
            Can’t summarise this removal — this household has no primary client
            on file. Add the client to the household, then remove the trust.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 py-3">
              {summary.facts.length === 0 ? (
                <p className="text-[13px] text-ink-3">
                  Nothing else in the plan refers to this trust.
                </p>
              ) : (
                <ul className="space-y-1.5 text-[13px] text-ink-2">
                  {summary.facts.map((f) => (
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
            {summary.fallbackNote && (
              <p className="text-[12px] leading-relaxed text-ink-3">
                {summary.fallbackNote}
              </p>
            )}
          </div>
        )}
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
          disabled={summary === null}
          className="rounded-[var(--radius-sm)] border border-crit/50 px-3 py-1.5 text-[13px] font-medium text-crit hover:bg-crit/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Remove trust
        </button>
      </div>
    </div>
  );
}
