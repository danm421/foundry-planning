"use client";

import BuyLegEditor from "@/components/forms/asset-transaction-buy-leg";
import type { BuyLegDraft } from "@/components/forms/asset-transaction-leg-model";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import type {
  AssembleGoals,
  EducationGoal,
  HomePurchaseGoal,
} from "@/lib/imports/assemble/types";
import { stated } from "@/lib/imports/assemble/field";
import AssumedChip from "./assumed-chip";
import { chipFor, FieldLabel } from "./provenance-fields";

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

interface GoalsStepProps {
  value: AssembleGoals;
  /**
   * Already-committed accounts. `category`/`subType` are REQUIRED, not
   * optional: `commitGoals` scopes education dedicated-funding resolution to
   * education accounts, so this step cannot render an honest funding list
   * without them (see `isEducationAccount` below). They previously defaulted to
   * `"cash"`/`"checking"`, which made every account look like a cash account.
   */
  accountOptions: { id: string; name: string; category: string; subType: string }[];
  dependentOptions: string[];
  currentYear: number;
  onChange: (next: AssembleGoals) => void;
}

/**
 * Mirrors `commitGoals`' candidate scoping EXACTLY (see the comment block at
 * the top of `src/lib/imports/commit/goals.ts`): an education goal's dedicated
 * funding resolves only against `category === "education_savings"` or the
 * `subType === "529"` fallback. Offering any other account as "Dedicated 529
 * funding" invites the advisor to tick a box the commit then silently drops.
 */
function isEducationAccount(a: { category: string; subType: string }): boolean {
  return a.category === "education_savings" || a.subType === "529";
}

/** BuyLegDraft is form state keyed by `key`; a goal is the same shape keyed by
 * `id`. `assetCategory` is fixed to `real_estate` — `HomePurchaseGoal` has no
 * such field because a planned purchase in this wizard is always a home. */
function toBuyLeg(goal: HomePurchaseGoal): BuyLegDraft {
  const { id, year: _year, ...rest } = goal;
  void _year;
  return { ...rest, key: id, kind: "buy", assetCategory: "real_estate" };
}

/**
 * Keys `BuyLegDraft` carries that don't exist on `HomePurchaseGoal` — most
 * notably `assetCategory`, which `HomePurchaseGoal` has no field for (a
 * planned purchase here is always a home; `toBuyLeg` hardcodes
 * `assetCategory: "real_estate"` every render). `BuyLegEditor`'s own Category
 * select is restricted to `["real_estate"]` below so this can't normally
 * fire with anything else, but this filter is the belt to that select's
 * suspenders: even if a patch somehow carried `assetCategory` (or any other
 * `BuyLegDraft`-only key), it can never be spread onto goal state — the
 * bare `as Partial<HomePurchaseGoal>` cast that used to sit at the one call
 * site let exactly that through at runtime despite the type-level lie.
 */
const BUY_LEG_ONLY_KEYS = new Set<string>(["key", "recordId", "kind", "assetCategory"]);

function toHomePurchasePatch(patch: Partial<BuyLegDraft>): Partial<HomePurchaseGoal> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!BUY_LEG_ONLY_KEYS.has(k)) clean[k] = v;
  }
  return clean as Partial<HomePurchaseGoal>;
}

function blankEducationGoal(id: string, currentYear: number): EducationGoal {
  return {
    id,
    name: { value: "Education Goal", provenance: "stated" },
    forFamilyMemberName: stated<string>(null),
    annualAmount: stated<number>(null),
    startYear: { value: currentYear + 1, provenance: "stated" },
    years: { value: 4, provenance: "stated" },
    growthRate: { value: 0.05, provenance: "stated" },
    payShortfallOutOfPocket: { value: false, provenance: "stated" },
    dedicatedAccountNames: [],
  };
}

function blankHomePurchase(id: string, currentYear: number): HomePurchaseGoal {
  return {
    id, name: "", year: String(currentYear + 1), assetName: "",
    assetSubType: "primary_residence", purchasePrice: "", growthRate: "", basis: "",
    fundingAccountId: "", showMortgage: false,
    mortgageAmount: "", mortgageRate: "", mortgageTermMonths: "360",
  };
}

/**
 * The "Dedicated 529 funding" block for one education goal.
 *
 * `dedicatedAccountNames` is resolved at commit time BY NAME against rows the
 * Accounts tab wrote — a cross-tab, order-dependent reference. Three ordinary
 * advisor actions leave a name that resolves to nothing: renaming the 529 in
 * the Accounts step (which is what that step is FOR), leaving a `fuzzy` row
 * unresolved (`commitAccounts` skips it while the tab still records a commit
 * timestamp), and a fuzzy match onto an existing DB account under a different
 * name. The wizard's accounts-first ordering guard asks "are there uncommitted
 * accounts?", which none of those three trip.
 *
 * So every name with no matching education account is rendered as a visible
 * unmatched row with a remove control. Critically this renders even when
 * `educationAccounts` is EMPTY — a fresh import, before Accounts is committed,
 * is precisely when the derived names are at risk, and the old
 * `accountOptions.length > 0` gate hid them exactly then.
 */
function DedicatedFunding({
  goal,
  educationAccounts,
  educationAccountNames,
  onToggle,
}: {
  goal: EducationGoal;
  educationAccounts: { id: string; name: string }[];
  educationAccountNames: Set<string>;
  onToggle: (goal: EducationGoal, accountName: string) => void;
}) {
  const unmatched = goal.dedicatedAccountNames.filter((n) => !educationAccountNames.has(n));
  if (educationAccounts.length === 0 && unmatched.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-gray-300">Dedicated 529 funding</p>
      {educationAccounts.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {educationAccounts.map((account) => (
            <label key={account.id} className="flex items-center gap-1.5 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={goal.dedicatedAccountNames.includes(account.name)}
                onChange={() => onToggle(goal, account.name)}
              />
              {account.name}
            </label>
          ))}
        </div>
      )}
      {unmatched.length > 0 && (
        <ul className="mt-2 space-y-1">
          {unmatched.map((name) => (
            <li
              key={name}
              className="flex items-start justify-between gap-2 rounded border border-amber-700/50 bg-amber-900/20 px-2 py-1.5 text-xs text-amber-200"
            >
              <span>
                No committed account named{" "}
                <span className="font-medium text-amber-100">{name}</span>. Until one exists, this
                goal will be created without that dedicated funding.
              </span>
              <button
                type="button"
                aria-label={`Remove funding account ${name}`}
                onClick={() => onToggle(goal, name)}
                className="shrink-0 text-amber-300 underline hover:text-amber-100"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The Goals review step: education goals (`AssembleGoals.education`, each
 * field a `PlanBasicsField` provenance envelope — chipped when derived) and
 * planned purchases (`AssembleGoals.homePurchases`, plain form strings with
 * no provenance — extraction has no concept of a future purchase intent, so
 * nothing there is ever derived).
 *
 * Controlled, like `plan-basics-step.tsx`: no internal copy of `value`,
 * every edit goes out through `onChange`. A manually ADDED goal's defaults
 * are `stated`, not `derived` — the advisor chose them by clicking Add; only
 * `deriveGoals` emits `derived` provenance, and only with a `reason`.
 */
export default function GoalsStep({
  value, accountOptions, dependentOptions, currentYear, onChange,
}: GoalsStepProps) {
  const setEducation = (id: string, patch: Partial<EducationGoal>) =>
    onChange({
      ...value,
      education: value.education.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    });

  const setPurchase = (id: string, patch: Partial<HomePurchaseGoal>) =>
    onChange({
      ...value,
      homePurchases: value.homePurchases.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });

  const addEducation = () =>
    onChange({
      ...value,
      education: [...value.education, blankEducationGoal(crypto.randomUUID(), currentYear)],
    });

  const addPurchase = () =>
    onChange({
      ...value,
      homePurchases: [...value.homePurchases, blankHomePurchase(crypto.randomUUID(), currentYear)],
    });

  const removeEducation = (id: string) =>
    onChange({ ...value, education: value.education.filter((g) => g.id !== id) });

  const removePurchase = (id: string) =>
    onChange({ ...value, homePurchases: value.homePurchases.filter((p) => p.id !== id) });

  /** Dedicated 529 funding is names in click order, not ids — the 529 may not
   * be committed yet (see `AssembleGoals.dedicatedAccountNames` doc). Toggling
   * off never reorders the names that remain. */
  const toggleDedicatedAccount = (goal: EducationGoal, accountName: string) => {
    const dedicatedAccountNames = goal.dedicatedAccountNames.includes(accountName)
      ? goal.dedicatedAccountNames.filter((n) => n !== accountName)
      : [...goal.dedicatedAccountNames, accountName];
    setEducation(goal.id, { dedicatedAccountNames });
  };

  const educationAccounts = accountOptions.filter(isEducationAccount);
  const educationAccountNames = new Set(educationAccounts.map((a) => a.name));

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
          Education goals
        </h3>
        <div className="space-y-3">
          {value.education.map((goal) => (
            <div key={goal.id} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-100">
                    {goal.name.value || "Education Goal"}
                  </span>
                  <AssumedChip assumption={chipFor(goal.name)} />
                </div>
                <button
                  type="button"
                  onClick={() => removeEducation(goal.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel id={`${goal.id}-amount`} label="Annual cost" field={goal.annualAmount} />
                  <CurrencyInput
                    id={`${goal.id}-amount`}
                    value={goal.annualAmount.value ?? ""}
                    onChange={(raw) =>
                      setEducation(goal.id, { annualAmount: stated(raw === "" ? null : Number(raw)) })
                    }
                  />
                  {goal.annualAmount.value == null && (
                    <p className="mt-1 text-xs text-amber-400">
                      Add an annual cost — this goal will not be created without one.
                    </p>
                  )}
                </div>

                <div>
                  <FieldLabel id={`${goal.id}-student`} label="Student" field={goal.forFamilyMemberName} />
                  <select
                    id={`${goal.id}-student`}
                    className={INPUT_CLASS}
                    value={goal.forFamilyMemberName.value ?? ""}
                    onChange={(e) =>
                      setEducation(goal.id, { forFamilyMemberName: stated(e.target.value || null) })
                    }
                  >
                    <option value="">Not specified</option>
                    {dependentOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <FieldLabel id={`${goal.id}-start-year`} label="Start year" field={goal.startYear} />
                  <input
                    id={`${goal.id}-start-year`}
                    type="number"
                    className={INPUT_CLASS}
                    value={goal.startYear.value ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setEducation(goal.id, { startYear: stated(raw === "" ? null : Number(raw)) });
                    }}
                  />
                </div>

                <div>
                  <FieldLabel id={`${goal.id}-years`} label="Years" field={goal.years} />
                  <input
                    id={`${goal.id}-years`}
                    type="number"
                    className={INPUT_CLASS}
                    value={goal.years.value ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setEducation(goal.id, { years: stated(raw === "" ? null : Number(raw)) });
                    }}
                  />
                </div>

                <div>
                  <FieldLabel id={`${goal.id}-growth`} label="Growth rate" field={goal.growthRate} />
                  <PercentInput
                    id={`${goal.id}-growth`}
                    value={goal.growthRate.value != null ? (goal.growthRate.value * 100).toFixed(2) : ""}
                    onChange={(raw) =>
                      setEducation(goal.id, {
                        growthRate: stated(raw === "" ? null : Number(raw) / 100),
                      })
                    }
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-1.5">
                {/* The chip stays OUTSIDE the <label>, same rule as
                    `FieldLabel` above: nesting it would fold the reason
                    prose into the checkbox's accessible name. */}
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={goal.payShortfallOutOfPocket.value ?? false}
                    onChange={(e) =>
                      setEducation(goal.id, { payShortfallOutOfPocket: stated(e.target.checked) })
                    }
                  />
                  Pay any shortfall from household cash
                </label>
                <AssumedChip assumption={chipFor(goal.payShortfallOutOfPocket)} />
              </div>

              <DedicatedFunding
                goal={goal}
                educationAccounts={educationAccounts}
                educationAccountNames={educationAccountNames}
                onToggle={toggleDedicatedAccount}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addEducation}
          className="mt-3 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-accent hover:bg-gray-700"
        >
          Add education goal
        </button>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
          Planned purchases
        </h3>
        <div className="space-y-3">
          {value.homePurchases.map((purchase) => (
            <div key={purchase.id} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="w-40">
                  <label htmlFor={`${purchase.id}-year`} className="mb-1 block text-xs text-gray-300">
                    Purchase year
                  </label>
                  <input
                    id={`${purchase.id}-year`}
                    type="number"
                    className={INPUT_CLASS}
                    value={purchase.year}
                    onChange={(e) => setPurchase(purchase.id, { year: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removePurchase(purchase.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
              {/* The shipped buy-leg editor, mounted a third time rather than
                  rebuilt: it already carries asset name / price / growth /
                  basis / funding account and the collapsible mortgage group,
                  and already defaults to real_estate + primary_residence +
                  360 months. `idPrefix` keeps its hardcoded ids (e.g.
                  "assetName") from colliding across multiple purchases. */}
              <BuyLegEditor
                idPrefix={`${purchase.id}-`}
                leg={toBuyLeg(purchase)}
                categories={["real_estate"]}
                // Deliberately UNSCOPED, unlike the education funding list
                // above: a down payment can legitimately come from any
                // account (Task 8 decision).
                accounts={accountOptions}
                onChange={(patch) => setPurchase(purchase.id, toHomePurchasePatch(patch))}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addPurchase}
          className="mt-3 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-accent hover:bg-gray-700"
        >
          Add planned purchase
        </button>
      </section>
    </div>
  );
}
