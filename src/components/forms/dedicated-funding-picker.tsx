"use client";

interface PickerAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
  /** Family member ids that own this account (from the polymorphic owners[]). */
  ownerFamilyMemberIds?: string[];
}

interface Props {
  accounts: PickerAccount[];
  /** Selected account ids, in draw order. */
  value: string[];
  onChange: (ids: string[]) => void;
  /**
   * When provided, only accounts owned by ≥1 of these family members are shown —
   * i.e. the household (client/spouse) plus the person the goal is for. Omit to
   * skip the ownership filter (category eligibility only).
   */
  allowedOwnerFamilyMemberIds?: string[];
}

// Accounts eligible to fund an education goal: cash, taxable, dedicated
// education_savings (529) accounts, and any account whose sub-type is 529
// even when categorized elsewhere (legacy import paths file 529s as taxable).
function isEligibleType(a: PickerAccount): boolean {
  return (
    a.category === "cash" ||
    a.category === "taxable" ||
    a.category === "education_savings" ||
    a.subType === "529"
  );
}

/**
 * Multi-account "Dedicated Funding" picker. A checkbox list of eligible accounts;
 * selection order is the draw order (persisted as sort_order). New territory —
 * expenses have no multi-account precedent (mirrors CashAccountPicker's category
 * filter, rebuilt as a checklist).
 */
export function DedicatedFundingPicker({ accounts, value, onChange, allowedOwnerFamilyMemberIds }: Props) {
  const allowed = allowedOwnerFamilyMemberIds ? new Set(allowedOwnerFamilyMemberIds) : null;
  const eligible = accounts.filter(
    (a) =>
      isEligibleType(a) &&
      (allowed === null || (a.ownerFamilyMemberIds ?? []).some((id) => allowed.has(id))),
  );
  if (eligible.length === 0) {
    return <p className="text-xs text-gray-400">No eligible funding accounts (cash / taxable / 529).</p>;
  }
  const toggle = (id: string) =>
    value.includes(id) ? onChange(value.filter((v) => v !== id)) : onChange([...value, id]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300">Dedicated Funding</label>
      <div className="mt-1 space-y-1 rounded-md border border-gray-600 bg-gray-800 p-2">
        {eligible.map((a) => {
          const idx = value.indexOf(a.id);
          return (
            <label key={a.id} className="flex items-center gap-2 text-sm text-gray-100">
              <input type="checkbox" checked={idx >= 0} onChange={() => toggle(a.id)} aria-label={a.name} />
              <span>{a.name}</span>
              {idx >= 0 && <span className="text-xs text-gray-400">· #{idx + 1}</span>}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-gray-400">Drawn in the order selected. Uncovered cost is a shortfall unless &quot;pay out of pocket&quot; is on.</p>
    </div>
  );
}
