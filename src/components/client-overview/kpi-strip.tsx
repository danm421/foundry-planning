import type { ReactElement } from "react";
import KpiCard from "./kpi-card";

interface Props {
  clientId: string;
  netWorth: number | null;
  liquidPortfolio: number | null;
}

const todayIso = () =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

export default function KpiStrip(p: Props): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-[var(--gap-grid)] sm:grid-cols-2">
      <KpiCard
        href={`/clients/${p.clientId}/assets/balance-sheet-report`}
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
        href={`/clients/${p.clientId}/assets/investments`}
        num="02"
        categoryLabel="Liquidity"
        category="portfolio"
        label="Liquid portfolio"
        value={p.liquidPortfolio}
        valueFormat="currency"
        footnote="Excl. real estate, business"
        delta={null}
      />
    </div>
  );
}
