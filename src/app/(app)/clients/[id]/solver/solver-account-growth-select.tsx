"use client";

import type { Account } from "@/engine/types";
import type { SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import { selectClassName, fieldLabelClassName } from "@/components/forms/input-styles";

/** The <select> value for "inherit the plan's category default". */
export const CATEGORY_DEFAULT = "default";

/** The growth fields a picked source writes onto the working account, plus the
 *  Monte-Carlo asset mix the caller must register for it. `growthSource` and
 *  `modelPortfolioId` are view-only on the engine Account — they ride along so
 *  Save-to-base can put the same BASIS back rather than only the resolved rate
 *  (see accountGrowthBasis in the save-to-base route). */
export interface AccountGrowthChoice {
  growthRate: number;
  realization: Account["realization"];
  growthSource: string;
  modelPortfolioId: string | null;
  mix: SolverModelPortfolio["mix"];
}

/**
 * Resolve a raw <select> value into the account fields it implies.
 *
 * "default" deliberately keeps the resolved category rate on `growthRate`: the
 * engine reads the rate, not the source, so the working projection has to carry
 * a number even while the SAVED account is set to re-derive it each load.
 */
export function resolveAccountGrowthChoice(
  raw: string,
  portfolios: readonly SolverModelPortfolio[],
  categoryDefaultRate: number | null,
): AccountGrowthChoice | null {
  if (raw === CATEGORY_DEFAULT) {
    if (categoryDefaultRate == null) return null;
    return {
      growthRate: categoryDefaultRate,
      realization: undefined,
      growthSource: "default",
      modelPortfolioId: null,
      mix: [],
    };
  }
  const portfolio = portfolios.find((p) => p.id === raw);
  if (!portfolio) return null;
  return {
    growthRate: portfolio.growthRate,
    realization: portfolio.realization,
    growthSource: "model_portfolio",
    modelPortfolioId: portfolio.id,
    mix: portfolio.mix,
  };
}

/** The <select> value an account is currently on. An account whose stored
 *  source is neither "default" nor a model portfolio we can offer (asset mix,
 *  holdings, a custom rate) has no matching option — the caller renders its
 *  own "as entered" option so the dropdown never displays a source the account
 *  is not actually on. */
export function accountGrowthSelectValue(
  account: Pick<Account, "growthSource" | "modelPortfolioId">,
  portfolios: readonly SolverModelPortfolio[],
  categoryDefaultRate: number | null = 0,
): string | null {
  const source = account.growthSource ?? CATEGORY_DEFAULT;
  // Only claim "Plan default" when that option is actually rendered.
  if (source === CATEGORY_DEFAULT) {
    return categoryDefaultRate != null ? CATEGORY_DEFAULT : null;
  }
  if (source === "model_portfolio" && account.modelPortfolioId) {
    return portfolios.some((p) => p.id === account.modelPortfolioId)
      ? account.modelPortfolioId
      : null;
  }
  return null;
}

const pct = (rate: number) => `${(rate * 100).toFixed(2)}%`;

interface Props {
  /** null → the account is on a source this picker cannot offer; the "as
   *  entered" option is shown and selected until the advisor picks another. */
  value: string | null;
  portfolios: readonly SolverModelPortfolio[];
  /** null → the plan has no named default for this account's category, so the
   *  option is omitted rather than labelled with a rate that is not its
   *  default. Portfolios remain pickable. */
  categoryDefaultRate: number | null;
  /** Current resolved rate, shown on the "as entered" option. */
  currentRate: number;
  label?: string;
  id?: string;
  onChange: (raw: string) => void;
}

/**
 * "What does this account grow at?" — the plan's category default or one of the
 * firm's model portfolios. Distinct from a savings rule's growth, which escalates
 * the CONTRIBUTION, not the balance.
 */
export function SolverAccountGrowthSelect({
  value,
  portfolios,
  categoryDefaultRate,
  currentRate,
  label = "Account growth",
  id,
  onChange,
}: Props) {
  const AS_ENTERED = "__as_entered__";
  return (
    <div>
      <label className={fieldLabelClassName} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        aria-label={label}
        value={value ?? AS_ENTERED}
        onChange={(e) => onChange(e.target.value)}
        className={selectClassName}
      >
        {value === null && (
          <option value={AS_ENTERED}>{pct(currentRate)} — as entered</option>
        )}
        {categoryDefaultRate != null && (
          <option value={CATEGORY_DEFAULT}>
            {pct(categoryDefaultRate)} — Plan default
          </option>
        )}
        {portfolios.map((p) => (
          <option key={p.id} value={p.id}>
            {pct(p.growthRate)} — {p.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[12px] text-ink-3">
        What the balance earns each year. Contribution growth is set separately.
      </p>
    </div>
  );
}
