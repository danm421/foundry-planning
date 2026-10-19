"use client";
// src/components/fact-finder/holdings-rows.tsx
// The holdings inside an investment, retirement or 529 account, on a line under
// its row: "N holdings" and what they add up to against the account's current
// value, opening to a table where each figure is edited by clicking it and each
// holding can be removed. Every edit is one op through `onApply`; a refused
// value (false) shows the stored one again.
import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { inputCompactClassName } from "@/components/forms/input-styles";
import { holdingsReconciliation, materiallyUndershoots } from "@/lib/extraction/normalize-holdings";
import type { ExtractedHolding } from "@/lib/extraction/types";
import type { ClientOp } from "@/lib/fact-finder/ops";
import type { FFSection } from "@/lib/fact-finder/schema";
import { rowLabel } from "@/lib/fact-finder/state";
import type { FFHolding, FFHoldingField, FFRow } from "@/lib/fact-finder/types";
import { AlertIcon, ChevronDownIcon, TrashIcon } from "./icons";

type FigureKind = "text" | "number" | "price" | "money";

interface HoldingColumn {
  field: FFHoldingField;
  label: string;
  kind: FigureKind;
  width: string;
}

const COLUMNS: readonly HoldingColumn[] = [
  { field: "ticker", label: "Ticker", kind: "text", width: "min-w-20" },
  { field: "name", label: "Name", kind: "text", width: "min-w-56" },
  { field: "shares", label: "Shares", kind: "number", width: "min-w-24" },
  { field: "price", label: "Price", kind: "price", width: "min-w-24" },
  { field: "marketValue", label: "Market value", kind: "money", width: "min-w-28" },
  { field: "costBasis", label: "Cost basis", kind: "money", width: "min-w-28" },
];

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** A holding's figure as the screen shows it: whole dollars, a price to four places, "—" when blank. */
export function figureText(kind: FigureKind, value: string | number | null): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  if (kind === "money") return money(value);
  if (kind === "price") {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** What a holding is called on screen and in its controls' names. */
export function holdingName(h: FFHolding): string {
  return h.ticker ?? h.name ?? "Unnamed holding";
}

/** The extraction shape `holdingsReconciliation` reads (blank = absent). */
function asExtracted(h: FFHolding): ExtractedHolding {
  return {
    ticker: h.ticker ?? undefined,
    name: h.name ?? undefined,
    shares: h.shares ?? undefined,
    price: h.price ?? undefined,
    marketValue: h.marketValue ?? undefined,
    costBasis: h.costBasis ?? undefined,
  };
}

/** What the holdings add up to against the account's current value; warns when they're off by more than rounding. */
function Reconciliation({ id, row, holdings }: { id: string; row: FFRow; holdings: FFHolding[] }) {
  const stated = row.cells.currentValue?.value;
  const accountValue = typeof stated === "number" ? stated : undefined;
  const recon = holdingsReconciliation(holdings.map(asExtracted), accountValue);
  return (
    <span id={id} className={`inline-flex items-center gap-1 text-xs ${recon.flagged ? "text-warn" : "text-ink-3"}`}>
      {recon.flagged && <AlertIcon className="h-3.5 w-3.5" />}
      <span>
        Adds up to <span className="tabular">{money(recon.sum)}</span>
        {accountValue === undefined ? (
          " · no current value to compare"
        ) : (
          <>
            {" of "}
            <span className="tabular">{money(recon.total)}</span>
            {recon.flagged && (
              <>
                {" · "}
                <span className="tabular">{money(Math.abs(recon.gap))}</span>
                {materiallyUndershoots(recon) ? " short" : " over"}
              </>
            )}
          </>
        )}
      </span>
    </span>
  );
}

/** The open editor: saves on Enter or on leaving it, backs out on Escape. */
function FigureInput({
  column,
  label,
  initial,
  onDone,
}: {
  column: HoldingColumn;
  label: string;
  initial: string;
  /** The typed text (null = backed out), and whether a key closed it. */
  onDone: (typed: string | null, byKey: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  // Closing the editor removes the input, which can fire one more blur: finish once.
  const done = useRef(false);
  const finish = (typed: string | null, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(typed, byKey);
  };
  const props = {
    autoFocus: true,
    "aria-label": label,
    onBlur: () => finish(draft, false),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      // The figure takes the focus back at once; the key mustn't then press it.
      e.preventDefault();
      finish(e.key === "Enter" ? draft : null, true);
    },
  };
  if (column.kind === "money") {
    return <CurrencyInput {...props} compact value={draft} onChange={setDraft} className="tabular text-right" />;
  }
  const text = column.kind === "text";
  return (
    <input
      {...props}
      type="text"
      inputMode={text ? undefined : "decimal"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className={text ? inputCompactClassName : `${inputCompactClassName} tabular text-right`}
    />
  );
}

/** One figure: its value as a button that opens the editor. */
function HoldingFigure({
  column,
  name,
  value,
  onCommit,
}: {
  column: HoldingColumn;
  name: string;
  value: string | number | null;
  /** The typed text, only when it differs from the stored value. */
  onCommit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // Enter and Escape hand the focus back to the figure; clicking elsewhere doesn't.
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [editing]);

  const stored = value === null ? "" : String(value);
  if (editing) {
    return (
      <FigureInput
        column={column}
        label={`${column.label} for ${name}`}
        initial={stored}
        onDone={(typed, byKey) => {
          refocus.current = byKey;
          setEditing(false);
          if (typed !== null && typed.trim() !== stored) onCommit(typed.trim());
        }}
      />
    );
  }
  const text = figureText(column.kind, value);
  const numeric = column.kind !== "text";
  return (
    <button
      ref={button}
      type="button"
      aria-label={`Edit ${column.label.toLowerCase()} for ${name}: ${value === null ? "blank" : text}`}
      onClick={() => setEditing(true)}
      className={`flex min-h-7 w-full cursor-pointer items-center rounded-[var(--radius-sm)] border border-transparent px-1.5 transition-colors hover:border-hair-2 hover:bg-card-2 ${
        // A long name wraps rather than widening its column across the account's whole wide table.
        numeric ? "tabular justify-end whitespace-nowrap" : "max-w-80 text-left break-words"
      } ${value === null ? "text-ink-4" : "text-ink"}`}
    >
      {text}
    </button>
  );
}

export interface HoldingsRowProps {
  section: FFSection;
  /** An account row with at least one holding. */
  row: FFRow;
  /** Cells across the account's row before its actions, so the holdings line spans them. */
  colSpan: number;
  /** The account row's actions cell: an empty one beside the line carries that sticky column on down. */
  actionsClassName: string;
  /** `useFactFinder`'s `apply`: false when the edit was refused. */
  onApply: (ops: ClientOp[]) => boolean;
}

/**
 * On a read-only screen, which wraps the page in a disabled fieldset: the "N holdings" disclosure only shows
 * what's already there, and a button inside a disabled fieldset goes dead, so it is drawn as a non-form control.
 * A cell draws no clear button there at all.
 */
export const ViewOnlyContext = createContext(false);

/** The holdings line under an account row (a table row of its own). */
export function HoldingsRow({ section, row, colSpan, actionsClassName, onApply }: HoldingsRowProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const viewOnly = useContext(ViewOnlyContext);
  const holdings = row.holdings ?? [];
  const label = rowLabel(section, row);
  const target = { sectionId: section.id, rowId: row.id };
  const Tag = viewOnly ? "span" : "button";
  const toggleProps = viewOnly
    ? {
        role: "button",
        tabIndex: 0,
        onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((was) => !was);
          }
        },
      }
    : { type: "button" as const };
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-hair pb-2 pl-8 pr-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Tag
            {...toggleProps}
            aria-expanded={open}
            aria-controls={open ? `${id}-table` : undefined}
            aria-describedby={`${id}-sum`}
            onClick={() => setOpen((was) => !was)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-card-2 hover:text-ink"
          >
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
            />
            <span className="tabular">{holdings.length}</span> {holdings.length === 1 ? "holding" : "holdings"}{" "}
            <span className="sr-only">in {label}</span>
          </Tag>
          <Reconciliation id={`${id}-sum`} row={row} holdings={holdings} />
        </div>
        {open && (
          <table
            id={`${id}-table`}
            aria-label={`Holdings in ${label}`}
            className="mt-1 border-separate border-spacing-0 text-xs"
          >
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.field}
                    scope="col"
                    className={`border-b border-hair px-1.5 py-1.5 font-medium text-ink-3 ${column.kind === "text" ? "text-left" : "text-right"}`}
                  >
                    <div className={column.width}>{column.label}</div>
                  </th>
                ))}
                <td className="border-b border-hair" />
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  {COLUMNS.map((column) => (
                    <td key={column.field} className="p-0.5">
                      <HoldingFigure
                        column={column}
                        name={holdingName(h)}
                        value={h[column.field]}
                        onCommit={(text) =>
                          onApply([{ op: "setHolding", ...target, holdingId: h.id, field: column.field, value: text }])
                        }
                      />
                    </td>
                  ))}
                  <td className="p-0.5">
                    <button
                      type="button"
                      aria-label={`Remove ${holdingName(h)}`}
                      title="Remove — reading the documents again won't bring it back"
                      onClick={() => onApply([{ op: "removeHolding", ...target, holdingId: h.id }])}
                      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-card-2 hover:text-crit"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
      <td className={actionsClassName} />
    </tr>
  );
}
