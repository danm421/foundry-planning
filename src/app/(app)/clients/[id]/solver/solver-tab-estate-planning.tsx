"use client";

import { useMemo, useState } from "react";
import type { Account, ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { addGift, removeGift, updateGift } from "@/lib/estate/estate-flow-gifts";
import { buildAnnualExclusionMap } from "@/lib/gifts/resolve-annual-exclusion";
import EstateFlowAddGiftDialog from "@/components/estate-flow-add-gift-dialog";
import {
  isRevocableTagEligible,
  buildRevocableTagMutations,
} from "@/lib/solver/estate-levers";

interface Props {
  accounts: Account[];
  /**
   * The working/proposed tree. Its `externalBeneficiaries` include
   * scenario-added charities, and its accounts feed in-kind asset gifts.
   */
  clientData: ClientData;
  onChange: (m: SolverMutation) => void;
}

/** One-line label for a planned gift in the list. */
function giftSummary(g: EstateFlowGift): string {
  if (g.kind === "series")
    return `Series ${g.startYear}–${g.endYear}: $${g.annualAmount.toLocaleString()}/yr`;
  if (g.kind === "asset-once")
    return `Asset gift ${g.year}: ${Math.round(g.percent * 100)}%`;
  return `Cash gift ${g.year}: $${g.amount.toLocaleString()}`;
}

export function SolverTabEstatePlanning({ accounts, clientData, onChange }: Props) {
  const eligible = useMemo(
    () => accounts.filter(isRevocableTagEligible),
    [accounts],
  );

  const [enabled, setEnabled] = useState(false);
  const [trustName, setTrustName] = useState("Revocable Living Trust");
  const [taggedIds, setTaggedIds] = useState<Set<string>>(new Set());

  // ── Planned gifts ──────────────────────────────────────────────────────────
  const [gifts, setGifts] = useState<EstateFlowGift[]>([]);
  const [editing, setEditing] = useState<EstateFlowGift | null>(null);
  const [adding, setAdding] = useState(false);

  // Inline charity sub-form (the DB-coupled ExternalBeneficiaryDialog is unusable here).
  const [charityName, setCharityName] = useState("");
  const [charityType, setCharityType] = useState<"public" | "private">("public");

  const ps = clientData.planSettings;
  const taxInflationRate = ps.taxInflationRate ?? ps.inflationRate ?? 0;
  const annualExclusionByYear = useMemo(
    () =>
      buildAnnualExclusionMap(
        clientData.taxYearRows ?? [],
        ps.planStartYear,
        ps.planEndYear,
        taxInflationRate,
      ),
    [clientData.taxYearRows, ps.planStartYear, ps.planEndYear, taxInflationRate],
  );

  function upsertGift(draft: EstateFlowGift) {
    setGifts((gs) =>
      gs.some((g) => g.id === draft.id) ? updateGift(gs, draft) : addGift(gs, draft),
    );
    onChange({ kind: "gift-upsert", id: draft.id, value: draft });
    setEditing(null);
    setAdding(false);
  }

  function deleteGift(id: string) {
    setGifts((gs) => removeGift(gs, id));
    onChange({ kind: "gift-upsert", id, value: null });
    setEditing(null);
  }

  function addCharity() {
    const name = charityName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    onChange({
      kind: "external-beneficiary-upsert",
      id,
      value: { id, name, kind: "charity", charityType },
    });
    setCharityName("");
  }

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

      <section className="rounded-lg border border-hair bg-card p-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink">Planned gifts</span>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
            className="text-[12px] text-accent hover:underline"
          >
            Add gift
          </button>
        </div>

        {gifts.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-3">
            No planned gifts in this scenario.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {gifts.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between text-[13px] text-ink"
              >
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => setEditing(g)}
                >
                  {giftSummary(g)}
                </button>
                <button
                  type="button"
                  className="text-[12px] text-crit hover:underline"
                  onClick={() => deleteGift(g.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Inline "add charity" — makes a new charity available as a gift recipient. */}
        <div className="mt-3 flex items-end gap-2">
          <label className="flex-1 text-[12px] text-ink-2">
            New charity
            <input
              type="text"
              value={charityName}
              onChange={(e) => setCharityName(e.target.value)}
              placeholder="Charity name"
              className="mt-1 h-9 w-full rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <select
            aria-label="Charity type"
            value={charityType}
            onChange={(e) => setCharityType(e.target.value as "public" | "private")}
            className="h-9 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
          <button
            type="button"
            onClick={addCharity}
            className="h-9 rounded-md bg-accent px-3 text-[13px] text-white hover:bg-accent/90"
          >
            Add
          </button>
        </div>
      </section>

      {(adding || editing) && (
        <EstateFlowAddGiftDialog
          clientData={clientData}
          ledger={[]}
          taxInflationRate={taxInflationRate}
          annualExclusionByYear={annualExclusionByYear}
          editing={editing}
          onApply={upsertGift}
          onDelete={() => editing && deleteGift(editing.id)}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
