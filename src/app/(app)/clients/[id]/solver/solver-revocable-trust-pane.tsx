"use client";

// The Estate planning dialog's pane for one revocable living trust: its name
// and a checklist of the accounts that can sit in it. A revocable trust is not
// an entity — membership is just which accounts carry its name — so ticking an
// account moves it in and unticking moves it out. The checklist is shared with
// the new-trust wizard's Accounts step.

import { useState } from "react";
import type { Account, ClientData } from "@/engine/types";
import {
  revocableEligibleAccounts,
  revocableTagOf,
  sameTrustName,
  type RevocableTrustRow,
} from "@/lib/solver/revocable-trust-rows";
import { usd } from "@/lib/solver/technique-summaries";
import { focusRing } from "./guided-trust-ui";

/** Tick-list of accounts, scrolling inside a bounded box for large households. */
export function RevocableAccountChecklist({
  accounts,
  checked,
  onToggle,
}: {
  accounts: Account[];
  checked: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  if (accounts.length === 0) {
    return <p className="text-[12px] text-ink-3">No accounts can go in a revocable trust.</p>;
  }
  return (
    <div
      role="group"
      aria-label="Accounts in this trust"
      className="max-h-[36vh] space-y-0.5 overflow-y-auto rounded-[var(--radius-sm)] border border-hair p-1"
    >
      {accounts.map((a) => (
        <label
          key={a.id}
          className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-[13px] text-ink-2 hover:bg-card-2"
        >
          <input
            type="checkbox"
            checked={checked.has(a.id)}
            onChange={() => onToggle(a.id)}
            className={`accent-[var(--color-accent)] ${focusRing}`}
          />
          <span className="min-w-0 flex-1 truncate">{a.name}</span>
          <span className="tabular shrink-0 text-[12px] text-ink-3">{usd(a.value)}</span>
        </label>
      ))}
    </div>
  );
}

interface PaneProps {
  row: RevocableTrustRow;
  tree: ClientData;
  onSetMembership: (name: string, taggedIds: Set<string>) => void;
  onRename: (from: string, to: string) => void;
  onRemove: (name: string) => void;
}

export function SolverRevocableTrustPane({ row, tree, onSetMembership, onRename, onRemove }: PaneProps) {
  const [draft, setDraft] = useState(row.name);
  const [error, setError] = useState<string | null>(null);
  const eligible = revocableEligibleAccounts(tree.accounts, row.name);
  const checked = new Set(row.accountIds);

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSetMembership(row.name, next);
  };

  const commit = () => {
    const name = draft.trim();
    if (name === row.name) {
      setDraft(row.name);
      setError(null);
      return;
    }
    const taken = tree.accounts.some((a) => {
      const t = revocableTagOf(a);
      return t !== null && t !== row.name && sameTrustName(t, name);
    });
    const problem = !name ? "Name the trust." : taken ? "Another trust already uses that name." : null;
    if (problem) {
      setError(problem);
      setDraft(row.name);
      return;
    }
    setError(null);
    onRename(row.name, name);
  };

  return (
    <div>
      <label className="block text-[12px] text-ink-3">
        Trust name
        <input
          type="text"
          value={draft}
          readOnly={row.isBase}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => {
            if (!row.isBase) commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !row.isBase) {
              e.preventDefault();
              commit();
            }
          }}
          className={`mt-1 block w-full max-w-sm rounded border border-hair-2 bg-card px-2 py-1 text-[13px] text-ink read-only:bg-card-2 read-only:text-ink-2 ${focusRing}`}
        />
      </label>
      {row.isBase ? (
        <p className="mt-1 text-[11.5px] text-ink-3">Rename a base-plan trust from the Estate Planning page.</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-[11.5px] text-crit">
          {error}
        </p>
      ) : null}

      <div className="mb-1.5 mt-3 text-[10.5px] uppercase tracking-[0.12em] text-ink-4">Accounts in this trust</div>
      <RevocableAccountChecklist accounts={eligible} checked={checked} onToggle={toggle} />

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => onRemove(row.name)}
          className={`rounded-[var(--radius-sm)] border border-crit/50 px-3 py-1 text-[12.5px] font-medium text-crit hover:bg-crit/10 ${focusRing}`}
        >
          Remove trust
        </button>
      </div>
    </div>
  );
}
