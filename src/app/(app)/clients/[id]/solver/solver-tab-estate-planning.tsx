"use client";

import { useMemo, useState } from "react";
import type { Account } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import {
  isRevocableTagEligible,
  buildRevocableTagMutations,
} from "@/lib/solver/estate-levers";

interface Props {
  accounts: Account[];
  onChange: (m: SolverMutation) => void;
}

export function SolverTabEstatePlanning({ accounts, onChange }: Props) {
  const eligible = useMemo(
    () => accounts.filter(isRevocableTagEligible),
    [accounts],
  );

  const [enabled, setEnabled] = useState(false);
  const [trustName, setTrustName] = useState("Revocable Living Trust");
  const [taggedIds, setTaggedIds] = useState<Set<string>>(new Set());

  function apply(nextTagged: Set<string>, nextName: string) {
    for (const m of buildRevocableTagMutations(accounts, nextTagged, nextName)) {
      onChange(m);
    }
  }

  function toggleEnabled(on: boolean) {
    setEnabled(on);
    // On enable: preserve the previous selection (user can refine before re-dispatch).
    // On disable: clear the selection so every eligible account gets a null-clearing upsert.
    const next = on ? taggedIds : new Set<string>();
    if (!on) setTaggedIds(next);
    apply(next, trustName);
  }

  function toggleAccount(id: string) {
    const next = new Set(taggedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTaggedIds(next);
    apply(next, trustName);
  }

  function selectAll() {
    const next = new Set(eligible.map((a) => a.id));
    setTaggedIds(next);
    apply(next, trustName);
  }

  function changeName(name: string) {
    setTrustName(name);
    if (enabled) apply(taggedIds, name);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-5 py-5">
      <h2 className="text-[15px] font-medium text-ink">Estate Planning</h2>

      <section className="rounded-lg border border-hair bg-card p-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
            className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-hair-2 bg-card-2 transition-colors hover:border-accent/60 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          Create a revocable living trust
        </label>

        {enabled ? (
          <div className="mt-3 space-y-3">
            <label className="block text-[11px] text-ink-3" htmlFor="trust-name-input">
              Trust name
              <input
                id="trust-name-input"
                type="text"
                value={trustName}
                onChange={(e) => changeName(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>

            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-3">
                Move probate assets into the trust
              </span>
              <button
                type="button"
                onClick={selectAll}
                className="text-[12px] text-accent hover:underline"
              >
                Select all
              </button>
            </div>

            {eligible.length === 0 ? (
              <p className="text-[11px] text-ink-3">
                No probate-eligible accounts to move.
              </p>
            ) : (
              <div className="divide-y divide-hair rounded-md border border-hair bg-card-2">
                {eligible.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-card-hover"
                  >
                    <input
                      type="checkbox"
                      checked={taggedIds.has(a.id)}
                      onChange={() => toggleAccount(a.id)}
                      className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-hair-2 bg-card-2 transition-colors hover:border-accent/60 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
