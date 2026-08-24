"use client";

interface PickerAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
  /** Family member ids that own this account (from the polymorphic owners[]). */
  ownerFamilyMemberIds?: string[];
  /** 529 only — the designated beneficiary, when they're a family member. */
  beneficiaryFamilyMemberId?: string | null;
  /** 529 only — the designated beneficiary typed in as free text (someone with
   *  no family-member record, e.g. a grandchild). */
  beneficiaryName?: string | null;
}

interface Props {
  accounts: PickerAccount[];
  /** Selected account ids, in draw order. */
  value: string[];
  onChange: (ids: string[]) => void;
  /**
   * When provided, only accounts owned by ≥1 of these family members are shown —
   * i.e. the household (client/spouse) plus the person the goal is for. Omit to
   * skip the ownership filter (category eligibility only). 529s are exempt; see
   * `isEligible`.
   */
  allowedOwnerFamilyMemberIds?: string[];
  /** Family member id → display name, for naming a 529's beneficiary. */
  familyMemberNames?: Record<string, string>;
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

function is529(a: PickerAccount): boolean {
  return a.category === "education_savings" || a.subType === "529";
}

/**
 * A 529 is never filtered out by ownership. It has no family-member owner by
 * construction — the loader replaces its owners with an out-of-estate sentinel
 * (engine/ownership.ts) — so an ownership test on a 529 always fails, and the
 * one account most plans hold *for* college would be the one thing the advisor
 * couldn't pick. Its beneficiary is shown on the row instead, so a 529 sitting
 * in another child's name is visible rather than silently gone (and legitimately
 * usable: a beneficiary can be changed between siblings).
 */
function isEligible(a: PickerAccount, allowed: Set<string> | null): boolean {
  if (!isEligibleType(a)) return false;
  if (allowed === null || is529(a)) return true;
  return (a.ownerFamilyMemberIds ?? []).some((id) => allowed.has(id));
}

/**
 * Multi-account "Dedicated Funding" picker. A checkbox list of eligible accounts;
 * selection order is the draw order (persisted as sort_order). New territory —
 * expenses have no multi-account precedent (mirrors CashAccountPicker's category
 * filter, rebuilt as a checklist).
 */
export function DedicatedFundingPicker({
  accounts,
  value,
  onChange,
  allowedOwnerFamilyMemberIds,
  familyMemberNames,
}: Props) {
  const allowed = allowedOwnerFamilyMemberIds ? new Set(allowedOwnerFamilyMemberIds) : null;
  const eligible = accounts.filter((a) => isEligible(a, allowed));
  if (eligible.length === 0) {
    // Distinguish "the plan holds nothing that could fund this" from "it does,
    // but not for this person" — the second used to read as the first, which is
    // what made a hidden 529 look like an unsupported account type.
    const narrowed = accounts.some(isEligibleType);
    return (
      <p className="text-xs text-gray-400">
        {narrowed
          ? "The plan's cash / taxable / 529 accounts all belong to someone outside this goal."
          : "No eligible funding accounts (cash / taxable / 529)."}
      </p>
    );
  }
  const toggle = (id: string) =>
    value.includes(id) ? onChange(value.filter((v) => v !== id)) : onChange([...value, id]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300">Dedicated Funding</label>
      <div className="mt-1 space-y-1 rounded-md border border-gray-600 bg-gray-800 p-2">
        {eligible.map((a) => {
          const idx = value.indexOf(a.id);
          const beneficiary = a.beneficiaryFamilyMemberId
            ? familyMemberNames?.[a.beneficiaryFamilyMemberId] ?? null
            : a.beneficiaryName ?? null;
          // Amber only when the money is earmarked for someone this goal isn't
          // about — a plain reminder, not a block.
          const otherBeneficiary =
            allowed !== null &&
            !!a.beneficiaryFamilyMemberId &&
            !allowed.has(a.beneficiaryFamilyMemberId);
          return (
            <label key={a.id} className="flex items-center gap-2 text-sm text-gray-100">
              <input type="checkbox" checked={idx >= 0} onChange={() => toggle(a.id)} aria-label={a.name} />
              <span>{a.name}</span>
              {is529(a) &&
                (beneficiary ? (
                  <span className={`text-xs ${otherBeneficiary ? "text-amber-400" : "text-gray-400"}`}>
                    · for {beneficiary}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">· no beneficiary on file</span>
                ))}
              {idx >= 0 && <span className="text-xs text-gray-400">· #{idx + 1}</span>}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-gray-400">Drawn in the order selected. Uncovered cost is a shortfall unless &quot;pay out of pocket&quot; is on.</p>
    </div>
  );
}
