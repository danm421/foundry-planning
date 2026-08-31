"use client";

export type SalaryBasis = "owner" | "all" | "selected";

export interface SalaryOption {
  id: string;
  name: string;
  /** First name of whoever the salary belongs to. Two salaries commonly share
   *  a name ("Base Salary"), so the owner is not decoration — it is what makes
   *  the row identifiable. */
  ownerLabel: string;
}

export interface SalaryBasisValue {
  basis: SalaryBasis;
  incomeIds: string[];
}

/** Read a stored basis + list into component state. "selected" with nothing
 *  selected collapses to "owner" — the same fallback the engine applies. */
export function inferSalaryBasis(
  basis: string | null | undefined,
  incomeIds: readonly string[] | null | undefined,
): SalaryBasisValue {
  if (basis === "all") return { basis: "all", incomeIds: [] };
  if (basis === "selected" && incomeIds && incomeIds.length > 0) {
    return { basis: "selected", incomeIds: [...incomeIds] };
  }
  return { basis: "owner", incomeIds: [] };
}

interface Props {
  value: SalaryBasisValue;
  onChange: (next: SalaryBasisValue) => void;
  salaries: readonly SalaryOption[];
  idPrefix?: string;
}

/**
 * Which salaries a percent-of-salary contribution and employer match resolve
 * against. One panel governs both: the engine reads a single salary number per
 * rule (`salaryByRuleId`), so there is nothing to configure separately.
 *
 * Caller renders this only when a percentage is actually in play — in dollar or
 * IRS-max mode nothing reads salary, and the panel would be noise.
 */
export default function SalaryBasisFields({
  value,
  onChange,
  salaries,
  idPrefix = "sr",
}: Props) {
  const allChecked = value.basis === "all";
  const isChecked = (id: string) => allChecked || value.incomeIds.includes(id);

  function toggleAll(next: boolean) {
    onChange(next ? { basis: "all", incomeIds: [] } : { basis: "owner", incomeIds: [] });
  }

  function toggleOne(id: string, next: boolean) {
    // Coming off "all", materialise the full list first so unchecking one box
    // leaves the other salaries selected rather than clearing everything.
    const current = allChecked ? salaries.map((s) => s.id) : value.incomeIds;
    const ids = next ? [...current, id] : current.filter((x) => x !== id);
    if (ids.length === 0) return onChange({ basis: "owner", incomeIds: [] });
    // Every box checked means "all of them", including salaries added later.
    if (ids.length === salaries.length) return onChange({ basis: "all", incomeIds: [] });
    onChange({ basis: "selected", incomeIds: ids });
  }

  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/60 p-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">
        Salary basis
      </span>

      {salaries.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          No salaries in this plan. The percent resolves to nothing until one is added.
        </p>
      ) : (
        <>
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-200" htmlFor={`${idPrefix}-salary-all`}>
            <input
              id={`${idPrefix}-salary-all`}
              type="checkbox"
              checked={allChecked}
              onChange={(e) => toggleAll(e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-1 focus:ring-accent"
            />
            All salaries
          </label>

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {salaries.map((s) => (
              <label
                key={s.id}
                htmlFor={`${idPrefix}-salary-${s.id}`}
                className={`flex items-center gap-2 text-sm ${allChecked ? "text-gray-500" : "text-gray-200"}`}
              >
                <input
                  id={`${idPrefix}-salary-${s.id}`}
                  type="checkbox"
                  checked={isChecked(s.id)}
                  disabled={allChecked}
                  onChange={(e) => toggleOne(s.id, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
                <span className="truncate">
                  {s.name} — {s.ownerLabel}
                </span>
              </label>
            ))}
          </div>

          <p className="mt-2 text-xs text-gray-400">
            {value.basis === "owner"
              ? "Nothing selected — uses the account owner's salary."
              : value.basis === "all"
                ? "Every salary in the plan, including any added later."
                : `Resolves against ${value.incomeIds.length} of ${salaries.length} salaries.`}
          </p>
        </>
      )}
    </div>
  );
}
