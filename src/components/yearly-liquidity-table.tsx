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
  totals: YearlyLiquidityReport["totals"];
  showPortfolio: boolean;
}

export function YearlyLiquidityTable({ rows, totals, showPortfolio }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No liquidity data available.
      </div>
    );
  }

  const surplusOf = (r: Props["rows"][number]) =>
    showPortfolio ? r.surplusDeficitWithPortfolio : r.surplusDeficitInsuranceOnly;
  const totalSurplus = showPortfolio
    ? totals.surplusDeficitWithPortfolio
    : totals.surplusDeficitInsuranceOnly;

  return (
    <section className="overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/15">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-indigo-900/40 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">
            Hypothetical · Both die in year
          </span>
          <h2 className="text-base font-semibold text-gray-50">Estate Liquidity</h2>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-indigo-950/30">
            <tr className="text-[10px] uppercase tracking-[0.16em] text-indigo-300/70">
              <Th align="left">Year</Th>
              <Th align="left">Age</Th>
              <Th align="right" wrap>Insurance In Estate</Th>
              <Th align="right" wrap>Insurance Out Of Estate</Th>
              <Th align="right" wrap>Total Insurance Benefit</Th>
              {showPortfolio && <Th align="right" wrap>Total Portfolio Assets</Th>}
              <Th align="right" wrap accent>Total Transfer Cost</Th>
              <Th align="right" wrap>Surplus / Deficit</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-indigo-900/20">
            {rows.map((r) => {
              const surplus = surplusOf(r);
              const ageLabel =
                r.ageClient != null && r.ageSpouse != null
                  ? `${r.ageClient}/${r.ageSpouse}`
                  : (r.ageClient ?? r.ageSpouse ?? "—").toString();
              return (
                <tr key={r.year} className="text-gray-200 hover:bg-indigo-900/10">
                  <td className="px-3 py-1.5">{r.year}</td>
                  <td className="px-3 py-1.5 text-gray-400">{ageLabel}</td>
                  <Td>{fmt.format(r.insuranceInEstate)}</Td>
                  <Td>{fmt.format(r.insuranceOutOfEstate)}</Td>
                  <Td>{fmt.format(r.totalInsuranceBenefit)}</Td>
                  {showPortfolio && <Td>{fmt.format(r.totalPortfolioAssets)}</Td>}
                  <Td accent>{fmt.format(r.totalTransferCost)}</Td>
                  <SurplusCell value={surplus} />
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-indigo-900/40">
            <tr className="bg-indigo-950/30 text-sm font-semibold text-gray-50">
              <td className="px-3 py-2" colSpan={2}>
                Lifetime totals
              </td>
              <FootCell>{fmt.format(totals.insuranceInEstate)}</FootCell>
              <FootCell>{fmt.format(totals.insuranceOutOfEstate)}</FootCell>
              <FootCell>{fmt.format(totals.totalInsuranceBenefit)}</FootCell>
              {showPortfolio && <FootCell>{fmt.format(totals.totalPortfolioAssets)}</FootCell>}
              <FootCell>{fmt.format(totals.totalTransferCost)}</FootCell>
              <SurplusFootCell value={totalSurplus} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  align,
  accent,
  wrap,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  accent?: boolean;
  wrap?: boolean;
}) {
  const className =
    "px-3 py-2 align-bottom font-medium " +
    (align === "right" ? "text-right" : "text-left") +
    (accent ? " text-indigo-300" : "");
  if (!wrap) return <th className={className}>{children}</th>;
  return (
    <th className={className}>
      <span className="inline-block max-w-[6.5rem] whitespace-normal break-words leading-tight">
        {children}
      </span>
    </th>
  );
}

function Td({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  const className =
    "px-3 py-1.5 text-right font-mono tabular-nums " +
    (accent ? "text-indigo-300" : "text-gray-300");
  return <td className={className}>{children}</td>;
}

function FootCell({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-right font-mono tabular-nums">{children}</td>;
}

function SurplusCell({ value }: { value: number }) {
  const negative = value < 0;
  const className =
    "px-3 py-1.5 text-right font-mono tabular-nums " +
    (negative ? "text-red-400" : "text-emerald-400");
  return <td className={className}>{negative ? `(${fmt.format(-value)})` : fmt.format(value)}</td>;
}

function SurplusFootCell({ value }: { value: number }) {
  const negative = value < 0;
  const className =
    "px-3 py-2 text-right font-mono tabular-nums font-semibold " +
    (negative ? "text-red-400" : "text-emerald-400");
  return <td className={className}>{negative ? `(${fmt.format(-value)})` : fmt.format(value)}</td>;
}
