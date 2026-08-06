"use client";

import { useState, type ReactNode } from "react";
import { cleanInput, formatDisplay } from "@/components/currency-input";

// ─── Shared input/label tokens (consumed by every intake step) ───────────────
export const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent";
export const labelCls =
  "block text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3 mb-1";
export const selectCls = inputCls;

// ─── Numeric field plumbing ───────────────────────────────────────────────────
//
// Every numeric field below keeps an internal raw string of what was literally
// typed, so a partial entry survives round-tripping through a number: a
// trailing "." on the way to "1234.50", a lone "20" on the way to "2040". Only
// the parsed value flows up.
//
// The re-sync rule is the subtle part. State is adjusted during render when
// `value` changes — React's documented "adjust state on prop change" pattern —
// but a re-render carrying the number we ourselves just reported must be a
// no-op, or the in-progress text would be rewritten under the caret. Recording
// the reported value as `prevValue` at the moment we report it is what makes
// our own echo indistinguishable from no change at all.
//
// `parse` is the only thing the three fields disagree about: it turns what was
// typed into the text to keep and the number to report, where `undefined`
// means "not answered yet".

type ParsedInput = { raw: string; value: number | undefined };

function useNumericField(
  value: number | undefined,
  onChange: (next: number | undefined) => void,
  parse: (typed: string) => ParsedInput,
): { raw: string; onType: (typed: string) => void } {
  const [raw, setRaw] = useState(value === undefined ? "" : String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setRaw(value === undefined ? "" : String(value));
  }

  return {
    raw,
    onType(typed: string) {
      const next = parse(typed);
      setRaw(next.raw);
      setPrevValue(next.value);
      onChange(next.value);
    },
  };
}

/** Digits with at most one decimal point; "" and "." read as unanswered. */
function parseDecimal(typed: string): ParsedInput {
  // No sign — nothing these fields collect is ever negative.
  const raw = typed.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  return { raw, value: raw === "" || raw === "." ? undefined : Number(raw) };
}

// ─── MoneyInput ───────────────────────────────────────────────────────────────
//
// Dollar field that formats with a "$" prefix + thousands separators as you
// type (e.g. 50000 → "$50,000"), reusing the app's shared currency helpers but
// styled to match the intake form.

function parseMoney(typed: string): ParsedInput {
  const raw = cleanInput(typed);
  return { raw, value: raw === "" || raw === "." ? undefined : Number(raw) };
}

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
  const { raw, onType } = useNumericField(value, onChange, parseMoney);

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
        onChange={(e) => onType(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}

// ─── YearInput ────────────────────────────────────────────────────────────────
//
// Four-digit calendar-year field. It only reports a number once four digits are
// in — "20" on the way to "2040" would be a valid-looking int that the submit
// schema rejects with a confusing message, so a partial entry reads as "not
// answered" instead, and the step's default takes over.

function parseYear(typed: string): ParsedInput {
  const raw = typed.replace(/\D/g, "").slice(0, 4);
  return { raw, value: raw.length === 4 ? Number(raw) : undefined };
}

export function YearInput({
  id,
  value,
  onChange,
  ariaLabel,
  placeholder,
  disabled,
}: {
  id?: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { raw, onType } = useNumericField(value, onChange, parseYear);

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      maxLength={4}
      className={`${inputCls} tabular disabled:cursor-not-allowed disabled:opacity-50`}
      value={raw}
      onChange={(e) => onType(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
    />
  );
}

// ─── Suffixed number fields ───────────────────────────────────────────────────
//
// Plain positive number with an optional unit adornment — an interest rate
// ("6.5 %") or a count of years ("22 years"). Unlike MoneyInput these add no
// thousands separators, because nothing they collect is ever that large.
//
// The two exports below differ only in how they parse, which is the one thing
// `useNumericField` already takes as a parameter — so they share this body
// rather than a second copy of the suffix chrome.

interface SuffixedNumberProps {
  id?: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Unit shown inside the field's right edge, e.g. "%" or "years". */
  suffix?: string;
}

function SuffixedNumberInput({
  id,
  value,
  onChange,
  ariaLabel,
  placeholder,
  suffix,
  parse,
  inputMode,
}: SuffixedNumberProps & {
  parse: (typed: string) => ParsedInput;
  inputMode: "decimal" | "numeric";
}) {
  const { raw, onType } = useNumericField(value, onChange, parse);

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        className={`${inputCls} tabular ${suffix ? "pr-14" : ""}`}
        value={raw}
        onChange={(e) => onType(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Fractional values allowed — a rate, a part-year term. */
export function DecimalInput(props: SuffixedNumberProps) {
  return <SuffixedNumberInput {...props} parse={parseDecimal} inputMode="decimal" />;
}

/**
 * Whole numbers only. The fields it serves are `z.number().int()` on submit, and
 * letting a "2.5" through would fail the strict schema with a message the client
 * can't act on, long after they typed it.
 */
export function IntegerInput(props: SuffixedNumberProps) {
  return <SuffixedNumberInput {...props} parse={parseInteger} inputMode="numeric" />;
}

/** Digits only; "" reads as unanswered. */
function parseInteger(typed: string): ParsedInput {
  const raw = typed.replace(/\D/g, "");
  return { raw, value: raw === "" ? undefined : Number(raw) };
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
// Generic add/remove list of cards. One item is open for editing at a time;
// every other one folds to a summary row, so the form stays short no matter how
// many items a client lists. KPI totals sit above, and the Add button is a
// prominent accent button. Every intake step that collects a list uses it.
//
// Props:
//   addLabel      — button label (e.g. "Add account")
//   emptyMessage  — shown when the list is empty
//   emptyHint     — second line in the dashed empty panel
//   items         — the array currently in state
//   kpis          — totals above the list; exactly two (fixed two-up grid)
//   onAdd         — called with no args; caller appends exactly one blank item
//                   at the end, which CardList then opens
//   onRemove      — called with the index to drop; caller drops exactly that one
//   renderSummary — the folded row for item[i]
//   renderItem    — render the card body for item[i]; must NOT include the
//                   wrapper div — CardList provides it

export interface KpiSpec {
  label: string;
  value: string;
}

export interface CardListProps<T> {
  addLabel: string;
  emptyMessage: string;
  emptyHint: string;
  items: T[];
  kpis: [KpiSpec, KpiSpec];
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderSummary: (item: T, index: number) => CardSummary;
  renderItem: (item: T, index: number) => ReactNode;
}

export function CardList<T>({
  addLabel,
  emptyMessage,
  emptyHint,
  items,
  kpis,
  onAdd,
  onRemove,
  renderItem,
  renderSummary,
}: CardListProps<T>) {
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
