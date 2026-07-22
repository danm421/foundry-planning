"use client";

import BuyLegEditor from "@/components/forms/asset-transaction-buy-leg";
import type { BuyLegDraft } from "@/components/forms/asset-transaction-leg-model";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import type {
  AssembleGoals,
  EducationGoal,
  HomePurchaseGoal,
  PlanBasicsField,
} from "@/lib/imports/assemble/types";
import AssumedChip from "./assumed-chip";

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

interface GoalsStepProps {
  value: AssembleGoals;
  // Optional `category`/`subType` are NOT part of Task 11's contract (which
  // passes bare `{ id, name }[]`) — declared here only so `toBuyLegAccounts`
  // below can fall back to a sane default when a richer caller does supply
  // them. A `{ id, name }[]` argument still satisfies this type.
  accountOptions: { id: string; name: string; category?: string; subType?: string }[];
  dependentOptions: string[];
  currentYear: number;
  onChange: (next: AssembleGoals) => void;
}

/** A field carries a chip only when it was derived AND says why. Generic over T
 * so it serves the string, number and boolean fields alike — the plan-basics
 * version was number-only. */
function chipFor<T>(field: PlanBasicsField<T>) {
  if (field.provenance !== "derived" || !field.reason) return undefined;
  return { field: "", value: String(field.value ?? ""), reason: field.reason };
}

/** The advisor touched it, so it is stated — and a stated field must never keep
 * displaying as estimated. Dropping `reason` is what clears the chip; every
 * input goes through here so no call site can forget. */
function stated<T>(value: T | null): PlanBasicsField<T> {
  return { value, provenance: "stated" };
}

function FieldLabel<T>({ id, label, field }: { id: string; label: string; field: PlanBasicsField<T> }) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      {/* The chip stays OUTSIDE the <label>: nesting it folds the reason prose
          into the accessible name, and a reason mentioning another field's
          numbers can then match an unrelated getByLabelText regex. */}
      <label htmlFor={id} className="text-xs text-gray-300">{label}</label>
      <AssumedChip assumption={chipFor(field)} />
    </div>
  );
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
  const blank = <T,>(): PlanBasicsField<T> => ({ value: null, provenance: "stated" });
  return {
    id,
    name: { value: "Education Goal", provenance: "stated" },
    forFamilyMemberName: blank<string>(),
    annualAmount: blank<number>(),
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

              {accountOptions.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs text-gray-300">Dedicated 529 funding</p>
                  <div className="flex flex-wrap gap-3">
                    {accountOptions.map((account) => (
                      <label key={account.id} className="flex items-center gap-1.5 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={goal.dedicatedAccountNames.includes(account.name)}
                          onChange={() => toggleDedicatedAccount(goal, account.name)}
                        />
                        {account.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
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
                accounts={accountOptions.map((a) => ({
                  id: a.id, name: a.name, category: a.category ?? "cash", subType: a.subType ?? "checking",
                }))}
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
