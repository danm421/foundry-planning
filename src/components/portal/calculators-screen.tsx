import type { ReactElement } from "react";
import Link from "next/link";

/**
 * The Calculators index: one card per self-serve what-if tool.
 *
 * Two cards today. The grid is the extension point, so calculator #3 is a
 * card and a route rather than a restructure — and so the section reads as a
 * place the client comes back to, not a single buried page.
 */
interface CalculatorCard {
  slug: string;
  title: string;
  blurb: string;
}

const CALCULATORS: readonly CalculatorCard[] = [
  {
    slug: "debt-paydown",
    title: "Debt paydown",
    blurb:
      "See what paying a little extra each month does to the interest you owe and the year you finish.",
  },
  {
    slug: "savings-goal",
    title: "Savings goal",
    blurb:
      "Work out what you need to put away each month to afford something you're planning for.",
  },
];

export function CalculatorsScreen({
  basePath = "/portal",
}: {
  basePath?: string;
}): ReactElement {
  return (
    <div className="p-6 lg:p-10">
      <header className="mb-6">
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          Calculators<span className="dot">.</span>
        </h1>
        <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-3">
          Run the numbers on a decision before you talk it through with your advisor.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CALCULATORS.map((c) => (
          <Link
            key={c.slug}
            href={`${basePath}/calculators/${c.slug}`}
            // `.card:hover` already brightens the border — no extra hover class.
            className="card block p-5 transition-colors"
          >
            <div className="text-[15px] font-medium text-ink">{c.title}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{c.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
