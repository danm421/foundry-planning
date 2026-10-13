"use client";
// src/components/fact-finder/unassigned-holdings.tsx
// Holdings a document listed under an account this fact finder couldn't match,
// at the top of the Accounts page: each with what the document called its
// account, and a picker of the investment, retirement and 529 accounts to move
// it to.
import { Fragment, type ReactNode } from "react";
import { Card } from "@/components/card";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { inputCompactBaseClassName, selectChevronClassName } from "@/components/forms/input-styles";
import type { ClientOp } from "@/lib/fact-finder/ops";
import { FACT_FINDER_SECTIONS } from "@/lib/fact-finder/schema";
import { rowLabel } from "@/lib/fact-finder/state";
import type { FactFinderState, FFUnassignedHolding } from "@/lib/fact-finder/types";
import { figureText, holdingName } from "./holdings-rows";

const HEADING_ID = "fact-finder-unassigned-holdings";
const HOLDING_SECTIONS = FACT_FINDER_SECTIONS.filter((section) => section.holdings);

export interface UnassignedHoldingsProps {
  state: FactFinderState;
  /** `useFactFinder`'s `apply`: false when the edit was refused. */
  onApply: (ops: ClientOp[]) => boolean;
}

/** "AAPL · Apple Inc": the ticker and name the document gave. */
function titleOf(h: FFUnassignedHolding): string {
  return [h.ticker, h.name].filter(Boolean).join(" · ") || "Unnamed holding";
}

/** Shares, value, and the account the document named. */
function detailsOf(h: FFUnassignedHolding): ReactNode[] {
  const parts: ReactNode[] = [];
  if (h.shares !== null) {
    parts.push(
      <>
        <span className="tabular">{figureText("number", h.shares)}</span> shares
      </>,
    );
  }
  if (h.marketValue !== null) parts.push(<span className="tabular">{figureText("money", h.marketValue)}</span>);
  const hint = h.accountHint.trim();
  parts.push(hint ? `Listed under “${hint}”` : "No account given");
  return parts;
}

export function UnassignedHoldings({ state, onApply }: UnassignedHoldingsProps) {
  const accounts = HOLDING_SECTIONS.map((section) => ({ section, rows: state.sections[section.id] ?? [] })).filter(
    (group) => group.rows.length > 0,
  );
  const move = (holdingId: string, rowId: string) => {
    const group = accounts.find(({ rows }) => rows.some((row) => row.id === rowId));
    if (group) onApply([{ op: "assignHolding", holdingId, from: "unassigned", to: { sectionId: group.section.id, rowId } }]);
  };
  return (
    <Card aria-labelledby={HEADING_ID}>
      <div className="flex items-center gap-1.5 border-b border-hair px-[var(--pad-card)] py-3">
        <h3 id={HEADING_ID} className="text-sm font-semibold text-ink-2">
          Unassigned holdings
        </h3>
        <span className="tabular text-xs text-ink-3">{state.unassignedHoldings.length}</span>
        <FieldTooltip
          text="A document listed these holdings under an account this fact finder couldn't match. Pick the account each one belongs to."
          side="bottom"
        />
      </div>
      <ul className="divide-y divide-hair">
        {state.unassignedHoldings.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-[var(--pad-card)] py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{titleOf(h)}</p>
              <p className="text-xs text-ink-3">
                {detailsOf(h).map((part, i) => (
                  <Fragment key={i}>
                    {i > 0 && " · "}
                    {part}
                  </Fragment>
                ))}
              </p>
            </div>
            {accounts.length === 0 ? (
              <p className="text-xs text-ink-3">Add an investment, retirement or 529 account to move it to.</p>
            ) : (
              <select
                aria-label={`Account for ${holdingName(h)}`}
                value=""
                onChange={(e) => move(h.id, e.target.value)}
                className={`${inputCompactBaseClassName} ${selectChevronClassName} w-64 max-w-full`}
              >
                <option value="">Move to…</option>
                {accounts.map(({ section, rows }) => (
                  <optgroup key={section.id} label={section.label}>
                    {rows.map((row, i) => (
                      <option key={row.id} value={row.id}>
                        {`${i + 1}. ${rowLabel(section, row)}`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
