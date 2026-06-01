"use client";

import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface Props {
  rows: YearlyLiquidityReport["rows"];
  showPortfolio: boolean;
}

export function YearlyLiquidityTable({ rows, showPortfolio }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No liquidity data available.
      </div>
    );
  }

  const surplusOf = (r: Props["rows"][number]) =>
    showPortfolio ? r.surplusDeficitWithPortfolio : r.surplusDeficitInsuranceOnly;

  return (
    <section className="overflow-hidden rounded-lg border border-hair bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hair px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-ink-3">
            Hypothetical · Both die in year
          </span>
          <h2 className="text-base font-semibold text-ink">Estate Liquidity</h2>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-card-2">
            <tr>
              <Th align="left">Year</Th>
              <Th align="left">Age</Th>
              <Th align="right" wrap>Insurance In Estate</Th>
              <Th align="right" wrap>Insurance Out Of Estate</Th>
              <Th align="right" wrap>Total Insurance Benefit</Th>
              {showPortfolio && <Th align="right" wrap>Total Portfolio Assets</Th>}
              <Th align="right" wrap>Total Transfer Cost</Th>
              <Th align="right" wrap>
                Surplus / Deficit
                <span className="block text-[9px] font-normal normal-case tracking-normal text-ink-3">
                  {showPortfolio ? "with portfolio" : "insurance only"}
                </span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const surplus = surplusOf(r);
              const ageLabel =
                r.ageClient != null && r.ageSpouse != null
                  ? `${r.ageClient}/${r.ageSpouse}`
                  : (r.ageClient ?? r.ageSpouse ?? "—").toString();
              return (
                <tr key={r.year} className="group">
                  <td className="whitespace-nowrap border-b border-hair bg-card px-3 py-2 first:pl-4 tabular-nums text-ink group-hover:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)]">
                    {r.year}
                  </td>
                  <td className="whitespace-nowrap border-b border-hair bg-card px-3 py-2 tabular-nums text-ink-3 group-hover:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)]">
                    {ageLabel}
                  </td>
                  <Td>{fmt.format(r.insuranceInEstate)}</Td>
                  <Td>{fmt.format(r.insuranceOutOfEstate)}</Td>
                  <Td>{fmt.format(r.totalInsuranceBenefit)}</Td>
                  {showPortfolio && <Td>{fmt.format(r.totalPortfolioAssets)}</Td>}
                  <Td>{fmt.format(r.totalTransferCost)}</Td>
                  <SurplusCell value={surplus} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  align,
  wrap,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  wrap?: boolean;
}) {
  const className =
    "max-w-[9rem] whitespace-normal border-b-2 border-hair bg-card-2 px-3 py-3.5 text-[13px] font-semibold uppercase leading-tight tracking-wider text-ink-2 first:pl-4 last:pr-4 " +
    (align === "right" ? "text-right" : "text-left");
  if (!wrap) return <th className={className}>{children}</th>;
  return (
    <th className={className}>
      <span className="inline-block whitespace-normal break-words leading-tight">
        {children}
      </span>
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap border-b border-hair bg-card px-3 py-2 text-right tabular-nums text-ink group-hover:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)]">
      {children}
    </td>
  );
}

function SurplusCell({ value }: { value: number }) {
  const negative = value < 0;
  const className =
    "whitespace-nowrap border-b border-hair bg-card px-3 py-2 last:pr-4 text-right tabular-nums font-semibold group-hover:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)] " +
    (negative ? "text-crit" : "text-good");
  return <td className={className}>{negative ? `(${fmt.format(-value)})` : fmt.format(value)}</td>;
}
