"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { resolveClientProfileOptions } from "@/lib/presentations/pages/client-profile/options-schema";
import {
  MAX_EXPENSE_COLUMNS,
  MAX_YEARS_FROM_NOW,
  type ClientProfilePageOptions,
  type ExpenseColumnSpec,
} from "@/lib/presentations/pages/client-profile/types";

interface Props {
  value: ClientProfilePageOptions;
  onChange: (next: ClientProfilePageOptions) => void;
}

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

const NEW_YEARS_COLUMN: ExpenseColumnSpec = { kind: "yearsFromNow", years: 5 };

export function ClientProfileOptionsControl({ value, onChange }: Props) {
  // See resolveClientProfileOptions: a legacy deck hands the control `{}`.
  const opts = resolveClientProfileOptions(value);
  const columns = opts.expenseColumns;
  const setColumns = (expenseColumns: ExpenseColumnSpec[]) => onChange({ ...opts, expenseColumns });
  const setColumnAt = (i: number, next: ExpenseColumnSpec) =>
    setColumns(columns.map((c, j) => (j === i ? next : c)));

  return (
    <OptionsRow>
      <OptionsGroup label="Expense columns">
        {columns.map((col, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              aria-label={`Expense column ${i + 1}`}
              className={field}
              value={col.kind}
              onChange={(e) => {
                const kind = e.target.value as ExpenseColumnSpec["kind"];
                setColumnAt(i, kind === "yearsFromNow" ? NEW_YEARS_COLUMN : { kind });
              }}
            >
              <option value="current">This year</option>
              <option value="retirement">Retirement</option>
              <option value="yearsFromNow">Years from now</option>
            </select>
            {col.kind === "yearsFromNow" && (
              <input
                type="number"
                min={1}
                max={MAX_YEARS_FROM_NOW}
                aria-label={`Expense column ${i + 1}, years from now`}
                className={`w-16 ${field}`}
                value={col.years}
                onChange={(e) => {
                  // An emptied or out-of-range entry keeps the last good value
                  // rather than writing one the options schema rejects.
                  const years = Number(e.target.value);
                  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS_FROM_NOW) return;
                  setColumnAt(i, { kind: "yearsFromNow", years });
                }}
              />
            )}
            {columns.length > 1 && (
              <button
                type="button"
                aria-label={`Remove expense column ${i + 1}`}
                className="shrink-0 rounded px-2 py-1 text-[11px] text-ink-3 hover:text-crit"
                onClick={() => setColumns(columns.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          disabled={columns.length >= MAX_EXPENSE_COLUMNS}
          className="rounded border border-hair px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setColumns([...columns, NEW_YEARS_COLUMN])}
        >
          Add column
        </button>
      </OptionsGroup>
    </OptionsRow>
  );
}
