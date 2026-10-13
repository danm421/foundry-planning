"use client";
// src/components/fact-finder/unassigned-holdings.tsx
// Holdings a document listed under an account this fact finder couldn't match,
// at the top of the Accounts page: each with what the document called its
// account, and a picker of the investment, retirement and 529 accounts to move
// it to.
import { Fragment, useState, type ReactNode } from "react";
import { Card } from "@/components/card";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { inputCompactBaseClassName, selectChevronClassName } from "@/components/forms/input-styles";
import type { ClientOp } from "@/lib/fact-finder/ops";
import { FACT_FINDER_SECTIONS, type FFSection } from "@/lib/fact-finder/schema";
import { rowLabel } from "@/lib/fact-finder/state";
import type { FactFinderState, FFRow, FFUnassignedHolding } from "@/lib/fact-finder/types";
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

/** A section's accounts a holding can move to. */
interface AccountGroup {
  section: FFSection;
  rows: FFRow[];
}

/**
 * The account picker and its Move button. The select only chooses (a typed
 * digit or an arrow key changes a closed select); Move moves.
 */
function MoveTo({
  holding,
  accounts,
  onApply,
}: { holding: FFUnassignedHolding; accounts: AccountGroup[] } & Pick<UnassignedHoldingsProps, "onApply">) {
  const [choice, setChoice] = useState("");
  // A chosen account that has since gone counts as no choice.
  const group = accounts.find(({ rows }) => rows.some((row) => row.id === choice));
  const rowId = group ? choice : "";
  const name = holdingName(holding);
  return (
    <div className="flex max-w-full items-center gap-2">
      <select
        aria-label={`Account for ${name}`}
        value={rowId}
        onChange={(e) => setChoice(e.target.value)}
        className={`${inputCompactBaseClassName} ${selectChevronClassName} w-64 min-w-0`}
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
      <button
        type="button"
        aria-label={`Move ${name}`}
        disabled={!group}
        onClick={() =>
          group &&
          onApply([{ op: "assignHolding", holdingId: holding.id, from: "unassigned", to: { sectionId: group.section.id, rowId } }])
        }
        className="inline-flex h-8 shrink-0 items-center rounded-[var(--radius-sm)] border border-hair-2 px-3 text-xs font-medium text-accent transition-colors enabled:cursor-pointer enabled:hover:border-accent enabled:hover:bg-accent-wash enabled:hover:text-accent-ink disabled:text-ink-4"
      >
        Move
      </button>
    </div>
  );
}

export function UnassignedHoldings({ state, onApply }: UnassignedHoldingsProps) {
  const accounts: AccountGroup[] = HOLDING_SECTIONS.map((section) => ({ section, rows: state.sections[section.id] ?? [] })).filter(
    (group) => group.rows.length > 0,
  );
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
              <MoveTo holding={h} accounts={accounts} onApply={onApply} />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
