import Link from "next/link";
import MoneyText from "@/components/money-text";
import type { DefaultGrowthAtInflation } from "@/lib/investments/default-growth-at-inflation";

interface Props {
  clientId: string;
  warning: DefaultGrowthAtInflation | null;
}

/** Shown on Net Worth and in the Solver when taxable / retirement accounts are
 *  still compounding at inflation because nobody set the plan's growth rates.
 *  Renders nothing when the plan is fine — call sites don't need a guard. */
export function DefaultGrowthBanner({ clientId, warning }: Props) {
  if (!warning) return null;

  const { categories, accountCount, totalValue, rate } = warning;
  const plural = accountCount === 1 ? "" : "s";

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn"
    >
      <span>
        <MoneyText value={accountCount} format="int" /> {categories.join(" and ")} account
        {plural} (<MoneyText value={totalValue} />) still use the plan&rsquo;s default
        growth rate, so they grow at <MoneyText value={rate} format="pct" /> a
        year — the inflation rate, not a return assumption.
      </span>
      <Link
        href={`/clients/${clientId}/details/assumptions?tab=growth-inflation`}
        className="font-medium underline underline-offset-2 hover:no-underline"
      >
        Set growth rates
      </Link>
    </div>
  );
}
