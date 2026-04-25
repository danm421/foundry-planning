import type { ReactElement, ReactNode } from "react";
import KpiCard from "./kpi-card";

interface Props {
  clientId: string;
  netWorth: number | null;
  liquidPortfolio: number | null;
  mcSlot: ReactNode;
  yearsToRetirement: number | null;
  earliestRetirementYear?: number | null;
}

const todayIso = () =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

export default function KpiStrip(p: Props): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-[var(--gap-grid)] sm:grid-cols-2 md:grid-cols-4">
      <KpiCard
        href={`/clients/${p.clientId}/balance-sheet-report`}
        num="01"
        categoryLabel="Net worth"
        category="portfolio"
        label="Current net worth"
        value={p.netWorth}
        valueFormat="currency"
        footnote={`As of ${todayIso()}`}
        delta={null}
      />
      <KpiCard
        href={`/clients/${p.clientId}/investments`}
        num="02"
        categoryLabel="Liquidity"
        category="portfolio"
        label="Liquid portfolio"
        value={p.liquidPortfolio}
        valueFormat="currency"
        footnote="Excl. real estate, business"
        delta={null}
      />
      {p.mcSlot}
      <KpiCard
        href={`/clients/${p.clientId}/timeline`}
        num="04"
        categoryLabel="Horizon"
        category="tax"
        label="Years to retirement"
        value={p.yearsToRetirement}
        valueFormat="int"
        footnote={p.earliestRetirementYear != null ? `${p.earliestRetirementYear}` : ""}
        delta={null}
      />
    </div>
  );
}
