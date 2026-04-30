"use client";

import type { CommitWill } from "@/lib/imports/commit/will-types";
import type { MatchAnnotation } from "@/lib/imports/types";
import MatchColumn from "./match-column";
import type { MatchCandidate } from "./match-link-picker";
import WillBequestMapper, {
  isBequestResolved,
  type AssetOption,
  type RecipientOption,
  type WizardBequest,
} from "./will-bequest-mapper";

/**
 * Wizard-internal will shape. Replaces the extracted bequests array
 * with the wizard's resolved-or-discarded shape so the wizard can
 * track resolution state alongside the original hints.
 */
export interface WizardWill {
  grantor: "client" | "spouse";
  executor?: string;
  executionDate?: string;
  bequests: WizardBequest[];
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

interface ReviewStepWillsProps {
  wills: WizardWill[];
  onChange: (wills: WizardWill[]) => void;
  /** Recipient options shared across all wills (family + entities + spouse). */
  recipientOptions: RecipientOption[];
  /** Asset options shared across all wills (accounts + liabilities + all_assets). */
  assetOptions: AssetOption[];
  /** Optional match wiring per-will (one annotation per index, indexed parallel to `wills`). */
  matches?: Array<MatchAnnotation | undefined>;
  onMatchChange?: (index: number, match: MatchAnnotation) => void;
  candidates?: MatchCandidate[];
}

/**
 * Returns true if every non-discarded bequest across every will is
 * fully resolved. The wizard's "Commit Wills" button is gated on this.
 */
export function areAllBequestsResolved(wills: WizardWill[]): boolean {
  return wills.every((w) => w.bequests.every(isBequestResolved));
}

export default function ReviewStepWills({
  wills,
  onChange,
  recipientOptions,
  assetOptions,
  matches,
  onMatchChange,
  candidates = [],
}: ReviewStepWillsProps) {
  const matchingEnabled = Boolean(matches && onMatchChange);

  const updateWill = (index: number, patch: Partial<WizardWill>) => {
    onChange(wills.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  };

  const updateBequest = (
    willIndex: number,
    bequestIndex: number,
    next: WizardBequest,
  ) => {
    onChange(
      wills.map((w, i) =>
        i === willIndex
          ? {
              ...w,
              bequests: w.bequests.map((b, j) =>
                j === bequestIndex ? next : b,
              ),
            }
          : w,
      ),
    );
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-gray-100">
        Wills ({wills.length})
      </h3>
      {wills.length === 0 ? (
        <p className="text-xs text-ink-4">No wills extracted.</p>
      ) : null}

      {wills.map((will, wIndex) => {
        const resolvedCount = will.bequests.filter(isBequestResolved).length;
        const total = will.bequests.length;
        const allResolved = resolvedCount === total;
        const grantorLabel = will.grantor === "client" ? "Client" : "Spouse";

        return (
          <section
            key={wIndex}
            className="rounded-lg border border-gray-700 bg-gray-900/50 p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-semibold text-ink-2">
                  {grantorLabel}&rsquo;s Will
                </h4>
                {matchingEnabled && (
                  <MatchColumn
                    match={matches?.[wIndex]}
                    candidates={candidates}
                    entityKind="will"
                    onChange={(next) => onMatchChange?.(wIndex, next)}
                  />
                )}
              </div>
              <span
                className={`text-xs ${
                  allResolved ? "text-good" : "text-amber-400"
                }`}
              >
                {resolvedCount}/{total} bequests resolved
              </span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-300">Executor</label>
                <input
                  value={will.executor ?? ""}
                  onChange={(e) =>
                    updateWill(wIndex, { executor: e.target.value || undefined })
                  }
                  className={INPUT_CLASS}
                  placeholder="e.g. Jane Doe"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Execution date</label>
                <input
                  type="date"
                  value={will.executionDate ?? ""}
                  onChange={(e) =>
                    updateWill(wIndex, { executionDate: e.target.value || undefined })
                  }
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div className="space-y-3">
              <h5 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Bequests
              </h5>
              {will.bequests.length === 0 ? (
                <p className="text-xs text-ink-4">
                  No bequests extracted. Skip this will to ignore it on commit.
                </p>
              ) : (
                will.bequests.map((bequest, bIndex) => (
                  <WillBequestMapper
                    key={bIndex}
                    bequest={bequest}
                    recipientOptions={recipientOptions}
                    assetOptions={assetOptions}
                    onChange={(next) => updateBequest(wIndex, bIndex, next)}
                    onDiscard={() =>
                      updateBequest(wIndex, bIndex, { ...bequest, discarded: true })
                    }
                    onUndiscard={() =>
                      updateBequest(wIndex, bIndex, { ...bequest, discarded: false })
                    }
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Convert a ready-for-commit WizardWill[] into the CommitWill[] shape
 * the commit module expects. Caller must guard with
 * areAllBequestsResolved(); this function still drops discarded bequests
 * but assumes the rest are resolved.
 */
/**
 * Convert WizardWill[] to the CommitWill[] shape the commit module
 * expects. Caller must guard with areAllBequestsResolved(); discarded
 * bequests are dropped, all others are assumed resolved.
 */
export function wizardWillsToCommitShape(wills: WizardWill[]): CommitWill[] {
  return wills.map((w) => ({
    grantor: w.grantor,
    executor: w.executor,
    executionDate: w.executionDate,
    bequests: w.bequests
      .filter((b) => !b.discarded && b.kind && b.recipientKind)
      .map((b, i) => ({
        recipientNameHint: b.recipientNameHint,
        assetDescriptionHint: b.assetDescriptionHint,
        name: b.name ?? b.assetDescriptionHint,
        kind: b.kind!,
        assetMode: b.assetMode,
        accountId: b.accountId ?? null,
        liabilityId: b.liabilityId ?? null,
        condition: b.condition ?? "always",
        percentage: b.percentage,
        sortOrder: i,
        recipients: [
          {
            recipientKind: b.recipientKind!,
            recipientId: b.recipientId ?? null,
            percentage: 100,
            sortOrder: 0,
          },
        ],
      })),
  }));
}
