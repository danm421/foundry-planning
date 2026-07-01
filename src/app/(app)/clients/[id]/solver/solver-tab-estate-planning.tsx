"use client";

import { useState } from "react";
import type { Account, EntitySummary } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { SolverTechniqueRow } from "./solver-technique-row";
import type { SolverTrustDraft } from "./solver-trust-form";
import type { CurrentCharity } from "@/lib/solver/estate-current";

/** One-line label for a planned gift in the list. */
function giftSummary(g: EstateFlowGift): string {
  if (g.kind === "series")
    return `Series ${g.startYear}–${g.endYear}: $${g.annualAmount.toLocaleString()}/yr`;
  if (g.kind === "asset-once")
    return `Asset gift ${g.year}: ${Math.round(g.percent * 100)}%`;
  return `Cash gift ${g.year}: $${g.amount.toLocaleString()}`;
}

/** Revocable Living Trust section: the create-RLT toggle + name +
 *  probate-account checkboxes for the scenario surface. */
export function EstateRevocableTrustList({
  enabled,
  trustName,
  eligible,
  taggedIds,
  onToggleEnabled,
  onChangeName,
  onToggleAccount,
  onSelectAll,
}: {
  enabled: boolean;
  trustName: string;
  eligible: Account[];
  taggedIds: Set<string>;
  onToggleEnabled: (on: boolean) => void;
  onChangeName: (name: string) => void;
  onToggleAccount: (id: string) => void;
  onSelectAll: () => void;
}) {
  const [accountsOpen, setAccountsOpen] = useState(false);
  const selectedCount = eligible.reduce((n, a) => (taggedIds.has(a.id) ? n + 1 : n), 0);
  return (
    <div className="col-span-2 space-y-3">
      <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-hair-2 bg-card-2 transition-colors hover:border-accent/60 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        Create a revocable living trust
      </label>

      {enabled ? (
        <div className="space-y-3">
          <label className="block text-[11px] text-ink-3" htmlFor="trust-name-input">
            Trust name
            <input
              id="trust-name-input"
              type="text"
              value={trustName}
              onChange={(e) => onChangeName(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>

          {eligible.length === 0 ? (
            <p className="text-[11px] text-ink-3">No probate-eligible accounts to move.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setAccountsOpen((v) => !v)}
                  aria-expanded={accountsOpen}
                  className="flex items-center gap-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink-2"
                >
                  <span aria-hidden="true" className="text-ink-4">{accountsOpen ? "▾" : "▸"}</span>
                  Move probate assets into the trust
                  <span className="text-ink-4">· {selectedCount} of {eligible.length} selected</span>
                </button>
                <button type="button" onClick={onSelectAll} className="text-[12px] text-accent hover:underline">
                  Select all
                </button>
              </div>

              {accountsOpen ? (
                <div className="divide-y divide-hair rounded-md border border-hair bg-card-2">
                  {eligible.map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-card-hover"
                    >
                      <input
                        type="checkbox"
                        checked={taggedIds.has(a.id)}
                        onChange={() => onToggleAccount(a.id)}
                        className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-hair-2 bg-card-2 transition-colors hover:border-accent/60 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      />
                      {a.name}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Short title for a gift row (recipient-kind noun). */
function giftTitle(g: EstateFlowGift): string {
  const noun =
    g.recipient.kind === "entity" ? "Trust gift" : g.recipient.kind === "family_member" ? "Family gift" : "Charitable gift";
  return noun;
}

/** Planned Gifts section: unified list of all gifts (base + draft) rendered as
 *  SolverTechniqueRows with toggle / edit / remove. */
export function EstateGiftsList({
  gifts,
  baseGiftIds,
  onToggle,
  onEdit,
  onRemove,
}: {
  gifts: EstateFlowGift[];
  baseGiftIds: Set<string>;
  onToggle: (g: EstateFlowGift) => void;
  onEdit: (g: EstateFlowGift) => void;
  onRemove: (id: string) => void;
}) {
  if (gifts.length === 0) {
    return <div className="col-span-2 text-[12px] text-ink-4">No planned gifts</div>;
  }
  return (
    <div className="col-span-2 space-y-2">
      {gifts.map((g) => (
        <SolverTechniqueRow
          key={g.id}
          name={giftTitle(g)}
          summary={giftSummary(g)}
          enabled={g.enabled !== false}
          onToggle={() => onToggle(g)}
          badge={baseGiftIds.has(g.id) ? "Base plan" : "Added"}
          onEdit={() => onEdit(g)}
          onRemove={() => onRemove(g.id)}
        />
      ))}
    </div>
  );
}

/** Compact planned-gift on/off list for the Techniques tab — toggle + title +
 *  summary only (no Edit / Remove / Add). The heavier actions and the other
 *  estate sections stay behind the "Edit" modal. Renders nothing when there are
 *  no gifts, so callers can drop it in unconditionally. */
export function EstateGiftsToggleList({
  gifts,
  baseGiftIds,
  onToggle,
}: {
  gifts: EstateFlowGift[];
  baseGiftIds: Set<string>;
  onToggle: (g: EstateFlowGift) => void;
}) {
  if (gifts.length === 0) return null;
  return (
    <div className="col-span-2 space-y-2">
      {gifts.map((g) => (
        <SolverTechniqueRow
          key={g.id}
          name={giftTitle(g)}
          summary={giftSummary(g)}
          enabled={g.enabled !== false}
          onToggle={() => onToggle(g)}
          badge={baseGiftIds.has(g.id) ? "Base plan" : "Added"}
        />
      ))}
    </div>
  );
}

/** Trusts section: existing trust entities (read-only) plus scenario-added
 *  trusts (Remove). The Add-trust form renders once at the bottom of the tab,
 *  gated by `addingTrust`. */
export function EstateTrustsList({
  currentTrusts,
  addedTrusts,
  onRemove,
}: {
  currentTrusts: EntitySummary[];
  addedTrusts: SolverTrustDraft[];
  onRemove: (draft: SolverTrustDraft) => void;
}) {
  if (currentTrusts.length === 0 && addedTrusts.length === 0) {
    return <div className="col-span-2 text-[12px] text-ink-4">No trusts</div>;
  }

  return (
    <div className="col-span-2 space-y-1">
      {currentTrusts.map((t) => (
        <div key={t.id} className="text-[13px] text-ink-2">
          <span>{t.name ?? "Trust"}</span>
          {t.trustSubType ? <span> · {t.trustSubType.toUpperCase()}</span> : null}
        </div>
      ))}
      {addedTrusts.map((t) => (
        <div key={t.entity.id} className="flex items-center justify-between text-[13px] text-ink">
          <span>
            {t.entity.name} · {t.entity.trustSubType?.toUpperCase()}
          </span>
          <button
            type="button"
            className="text-[12px] text-crit hover:underline"
            onClick={() => onRemove(t)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

/** Charities section: existing + scenario-added charities, plus the inline
 *  "add charity" form. */
export function EstateCharitiesList({
  currentCharities: current,
  addedCharities,
  charityName,
  charityType,
  onChangeName,
  onChangeType,
  onAdd,
}: {
  currentCharities: CurrentCharity[];
  addedCharities: CurrentCharity[];
  charityName: string;
  charityType: "public" | "private";
  onChangeName: (v: string) => void;
  onChangeType: (v: "public" | "private") => void;
  onAdd: () => void;
}) {
  const rows = [...current, ...addedCharities];

  return (
    <div className="col-span-2 space-y-2">
      {rows.length === 0 ? (
        <div className="text-[12px] text-ink-4">No charities</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((c) => (
            <li key={c.id} className="text-[13px] text-ink-2">
              {c.name}
              <span className="ml-1 text-[11px] text-ink-3">({c.charityType})</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 pt-1">
        <label className="flex-1 text-[12px] text-ink-2">
          New charity
          <input
            type="text"
            value={charityName}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="Charity name"
            className="mt-1 h-9 w-full rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <select
          aria-label="Charity type"
          value={charityType}
          onChange={(e) => onChangeType(e.target.value as "public" | "private")}
          className="h-9 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <button
          type="button"
          onClick={onAdd}
          className="h-9 rounded-md bg-accent px-3 text-[13px] text-white hover:bg-accent/90"
        >
          Add
        </button>
      </div>
    </div>
  );
}
