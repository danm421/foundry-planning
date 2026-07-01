// src/components/balance-sheet-report/year-picker.tsx
"use client";

/** Per-year household ages, keyed by calendar year. Mirrors the engine's
 *  `ProjectionYear.ages` shape ({ client, spouse? }). */
export type AgesByYear = Record<number, { client: number; spouse?: number }>;

/** The picker's selection: the "Today" snapshot (advisor-entered current
 *  balances) or a specific end-of-year projection. */
export type AsOfSelection = { mode: "today" } | { mode: "eoy"; year: number };

interface YearPickerProps {
  years: number[];
  value: AsOfSelection;
  onChange: (sel: AsOfSelection) => void;
  /** Household ages per year — appended to each option (e.g. "2027 · 75 & 76"). */
  agesByYear?: AgesByYear;
  /** Current calendar year — labels the Today option "Today (2026)". */
  todayYear?: number;
}

const TODAY_VALUE = "today";

function agesLabel(a: { client: number; spouse?: number } | undefined): string {
  if (!a) return "";
  return a.spouse != null ? `${a.client} & ${a.spouse}` : `${a.client}`;
}

function withAges(base: string, ages: string): string {
  return ages ? `${base} · ${ages}` : base;
}

export default function YearPicker({ years, value, onChange, agesByYear, todayYear }: YearPickerProps) {
  // Ordered navigation sequence: Today first, then each end-of-year. Today
  // anchors to the first projection year (plan start) for its ages label.
  const anchorYear = years[0];
  const selectValue = value.mode === "today" ? TODAY_VALUE : String(value.year);
  const seqIndex = value.mode === "today" ? 0 : years.indexOf(value.year) + 1;
  const seqLength = years.length + 1;

  const goTo = (i: number) => {
    if (i <= 0) {
      onChange({ mode: "today" });
    } else if (i < seqLength) {
      onChange({ mode: "eoy", year: years[i - 1] });
    }
  };

  const handleSelect = (raw: string) => {
    onChange(raw === TODAY_VALUE ? { mode: "today" } : { mode: "eoy", year: Number(raw) });
  };

  const todayLabel = withAges(
    todayYear != null ? `Today (${todayYear})` : "Today",
    agesLabel(agesByYear?.[anchorYear]),
  );

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Previous period"
        onClick={() => goTo(seqIndex - 1)}
        disabled={seqIndex <= 0}
        className="rounded-md border border-hair-2 bg-card px-2 py-1 text-xs text-ink-2 hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ◀
      </button>
      <label className="sr-only" htmlFor="bs-year">Year</label>
      <select
        id="bs-year"
        value={selectValue}
        onChange={(e) => handleSelect(e.target.value)}
        className="rounded-md border border-hair-2 bg-card px-2 py-1 text-xs font-medium text-ink tabular-nums focus-visible:outline focus-visible:outline-accent"
      >
        <option value={TODAY_VALUE}>{todayLabel}</option>
        {years.map((y) => (
          <option key={y} value={y}>{withAges(String(y), agesLabel(agesByYear?.[y]))}</option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Next period"
        onClick={() => goTo(seqIndex + 1)}
        disabled={seqIndex >= seqLength - 1}
        className="rounded-md border border-hair-2 bg-card px-2 py-1 text-xs text-ink-2 hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ▶
      </button>
    </div>
  );
}
