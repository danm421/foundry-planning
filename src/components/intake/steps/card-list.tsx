"use client";

import { useState, type ReactNode } from "react";
import { cleanInput, formatDisplay } from "@/components/currency-input";

// ─── Shared input/label tokens (consumed by every intake step) ───────────────
export const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent";
export const labelCls =
  "block text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3 mb-1";
export const selectCls = inputCls;

// ─── MoneyInput ───────────────────────────────────────────────────────────────
//
// Dollar field that formats with a "$" prefix + thousands separators as you
// type (e.g. 50000 → "$50,000"), reusing the app's shared currency helpers but
// styled to match the intake form. Keeps an internal raw string so partial
// entries ("50000.", "0") survive while the numeric value flows up via onChange.

export function MoneyInput({
  id,
  value,
  onChange,
  ariaLabel,
  placeholder,
}: {
  id?: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  // Keep an internal raw string so partial entries survive (e.g. a trailing
  // "." while typing "1234.50"). Re-sync from the prop only when `value` truly
  // changes externally — re-render with the same numeric value (our own echo)
  // is a no-op, which is what preserves the in-progress decimal. This is React's
  // documented "adjust state during render on prop change" pattern.
  const [raw, setRaw] = useState(value === undefined ? "" : String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setRaw(value === undefined ? "" : String(value));
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-3">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className={`${inputCls} pl-7 tabular`}
        value={formatDisplay(raw)}
        onChange={(e) => {
          const cleaned = cleanInput(e.target.value);
          setRaw(cleaned);
          const num = cleaned === "" || cleaned === "." ? undefined : Number(cleaned);
          setPrevValue(num);
          onChange(num);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}

// ─── Owner field ──────────────────────────────────────────────────────────────
//
// Shared by every step that asks "whose is this?" (income, accounts). Two rules
// live here so the steps can't disagree: a household with no spouse is only
// offered the client, and a stored owner that isn't on offer (e.g. a spouse
// removed after the fact) falls back to the client rather than rendering blank.

export type IntakeOwner = "client" | "spouse" | "joint";

/** Names for the owner options; omit `hasSpouse` for a single-person household. */
export interface OwnerNames {
  clientName?: string;
  spouseName?: string;
  hasSpouse?: boolean;
}

export function ownerOptions({
  clientName,
  spouseName,
  hasSpouse = false,
}: OwnerNames): { value: IntakeOwner; label: string }[] {
  const opts: { value: IntakeOwner; label: string }[] = [
    { value: "client", label: clientName?.trim() || "Client" },
  ];
  if (hasSpouse) {
    opts.push({ value: "spouse", label: spouseName?.trim() || "Spouse" });
    opts.push({ value: "joint", label: "Joint" });
  }
  return opts;
}

/**
 * Label for a stored value, for read-only surfaces (e.g. a collapsed row).
 * An unrecognised value — an owner whose spouse was removed, a category from an
 * older draft — falls back to the first option, which is also what the matching
 * `<select>` shows.
 */
export function labelFor<V extends string>(
  options: readonly { value: V; label: string }[],
  value: V | undefined,
): string {
  return options.find((o) => o.value === value)?.label ?? options[0].label;
}

export function OwnerField({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: IntakeOwner | undefined;
  options: { value: IntakeOwner; label: string }[];
  onChange: (next: IntakeOwner) => void;
}) {
  const offered = new Set(options.map((o) => o.value));
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        Owner
      </label>
      <select
        id={id}
        className={selectCls}
        value={value && offered.has(value) ? value : "client"}
        onChange={(e) => onChange(e.target.value as IntakeOwner)}
        aria-label="Owner"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Whole-dollar display used by every list summary and KPI. */
export function money(n: number | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString()}`;
}

// ─── RemoveButton ─────────────────────────────────────────────────────────────

function XGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="absolute right-3 top-3 flex items-center gap-1 rounded-[var(--radius-sm)] border border-hair px-2 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 transition-colors hover:border-crit hover:text-crit"
    >
      <XGlyph />
      Remove
      <span className="sr-only">{label}</span>
    </button>
  );
}

// ─── Kpi ──────────────────────────────────────────────────────────────────────

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}
      </p>
      <p className="tabular mt-1 text-[20px] font-semibold text-ink">{value}</p>
    </div>
  );
}

// ─── AddButton ────────────────────────────────────────────────────────────────

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 py-2 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        strokeWidth={1.75}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d="M7 2v10M2 7h10" />
      </svg>
      {label}
    </button>
  );
}

// ─── SummaryRow ───────────────────────────────────────────────────────────────

/** What a collapsed row shows. `title` also names its Edit / Remove controls. */
export interface CardSummary {
  /** Left-hand headline, e.g. the item's name. Never blank — supply a fallback. */
  title: string;
  /** Muted second line, e.g. "Taxable brokerage · Client". */
  subtitle: string;
  /** Right-aligned dollar figure; the row formats it, so every list agrees. */
  amount: number | undefined;
}

function SummaryRow({
  summary,
  onEdit,
  onRemove,
}: {
  summary: CardSummary;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-hair bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-ink">{summary.title}</p>
        <p className="truncate text-[12px] text-ink-3">{summary.subtitle}</p>
      </div>
      <span className="tabular shrink-0 text-[14px] text-ink">{money(summary.amount)}</span>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${summary.title}`}
        className="shrink-0 rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${summary.title}`}
        className="shrink-0 rounded-[var(--radius-sm)] border border-hair p-1.5 text-ink-3 transition-colors hover:border-crit hover:text-crit"
      >
        <XGlyph />
      </button>
    </div>
  );
}

// ─── CardList ─────────────────────────────────────────────────────────────────
//
// Generic add/remove list of cards, in one of two shapes:
//
//   collapsed  — pass `renderSummary`. One item is open for editing at a time;
//                every other one folds to a summary row, so the form stays short
//                no matter how many items a client lists. KPI totals sit above,
//                and the Add button is a prominent accent button.
//   expanded   — omit `renderSummary`. Every card renders in full under a
//                section heading. The original shape; Property is its last
//                caller, and migrating it means adding `renderSummary` + `kpis`.
//
// Shared props:
//   addLabel      — button label (e.g. "Add account")
//   emptyMessage  — shown when the list is empty
//   items         — the array currently in state
//   onAdd         — called with no args; caller appends exactly one blank item
//                   at the end (collapsed mode then opens it)
//   onRemove      — called with the index to drop; caller drops exactly that one
//   renderItem    — render the card body for item[i]; must NOT include the
//                   wrapper div — CardList provides it

interface CardListBase<T> {
  addLabel: string;
  emptyMessage: string;
  items: T[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
}

export interface KpiSpec {
  label: string;
  value: string;
}

interface CollapsedProps<T> extends CardListBase<T> {
  /** The folded row for item[i] — supplying this selects collapsed mode. */
  renderSummary: (item: T, index: number) => CardSummary;
  /** Totals above the list. Exactly two — the row is a fixed two-up grid. */
  kpis: [KpiSpec, KpiSpec];
  /** Second line in the dashed empty panel. */
  emptyHint: string;
  heading?: never;
}

interface ExpandedProps<T> extends CardListBase<T> {
  /** Section eyebrow (e.g. "Property"). */
  heading: string;
  renderSummary?: never;
  kpis?: never;
  emptyHint?: never;
}

/** Collapsed mode when `renderSummary` is given, expanded mode otherwise. */
export type CardListProps<T> = CollapsedProps<T> | ExpandedProps<T>;

export function CardList<T>(props: CardListProps<T>) {
  return props.renderSummary ? <CollapsedList {...props} /> : <ExpandedList {...props} />;
}

// ─── Collapsed mode ───────────────────────────────────────────────────────────

function CollapsedList<T>({
  addLabel,
  emptyMessage,
  emptyHint,
  items,
  kpis,
  onAdd,
  onRemove,
  renderItem,
  renderSummary,
}: CollapsedProps<T>) {
  // Index of the item currently expanded for editing; null = all collapsed.
  // Adding opens the new item; revisiting the step opens nothing.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  function add() {
    onAdd();
    setEditingIndex(items.length); // open the one the caller just appended
  }

  function remove(index: number) {
    onRemove(index);
    setEditingIndex((cur) => {
      if (cur === null || cur === index) return null;
      return cur > index ? cur - 1 : cur;
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 px-4 py-10 text-center">
        <p className="text-[14px] text-ink-2">{emptyMessage}</p>
        <p className="mb-5 mt-1 text-[13px] text-ink-3">{emptyHint}</p>
        <AddButton label={addLabel} onClick={add} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── KPI totals + Add ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {kpis.map((kpi) => (
          <Kpi key={kpi.label} label={kpi.label} value={kpi.value} />
        ))}
      </div>
      <div className="flex justify-end">
        <AddButton label={addLabel} onClick={add} />
      </div>

      {/* ── Rows: one expanded editor, the rest collapsed ──────────── */}
      <div className="space-y-3">
        {items.map((item, i) =>
          i === editingIndex ? (
            <div
              key={i}
              className="rounded-[var(--radius-sm)] border border-hair bg-card p-4"
            >
              {renderItem(item, i)}

              {/* Editor controls */}
              <div className="mt-4 flex items-center justify-between border-t border-hair pt-3">
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:border-crit hover:text-crit"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setEditingIndex(null)}
                  className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <SummaryRow
              key={i}
              summary={renderSummary(item, i)}
              onEdit={() => setEditingIndex(i)}
              onRemove={() => remove(i)}
            />
          ),
        )}
      </div>
    </div>
  );
}

// ─── Expanded mode ────────────────────────────────────────────────────────────

function ExpandedList<T>({
  heading,
  addLabel,
  emptyMessage,
  items,
  onAdd,
  onRemove,
  renderItem,
}: ExpandedProps<T>) {
  return (
    <div className="space-y-6">
      {/* ── Section heading + Add button ──────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
          {heading}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          {addLabel}
        </button>
      </div>

      {/* ── Empty state ───────────────────────────────────────────── */}
      {items.length === 0 && (
        <p className="text-[13px] text-ink-4">{emptyMessage}</p>
      )}

      {/* ── Item cards ────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="relative rounded-[var(--radius-sm)] border border-hair bg-card p-4"
            >
              <RemoveButton label={`item ${i + 1}`} onRemove={() => onRemove(i)} />
              {renderItem(item, i)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
