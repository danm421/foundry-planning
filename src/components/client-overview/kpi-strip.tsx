import Link from "next/link";
import { KpiCard } from "@/components/monte-carlo/kpi-card";

type Props = {
  clientId: string;
  netWorth: number | null;
  liquidPortfolio: number | null;
  monteCarloSuccess: number | null; // 0..1
  yearsToRetirement: number | null;
};

const fmt = (n: number | null) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

export default function KpiStrip(p: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Link href={`/clients/${p.clientId}/balance-sheet-report`}>
        <KpiCard label="Net worth" value={fmt(p.netWorth)} />
      </Link>
      <Link href={`/clients/${p.clientId}/investments`}>
        <KpiCard label="Liquid portfolio" value={fmt(p.liquidPortfolio)} />
      </Link>
      <Link href={`/clients/${p.clientId}/monte-carlo`}>
        <KpiCard
          label="Monte Carlo success"
          value={p.monteCarloSuccess == null ? "—" : `${Math.round(p.monteCarloSuccess * 100)}%`}
        />
      </Link>
      <Link href={`/clients/${p.clientId}/timeline`}>
        <KpiCard
          label="Years to retirement"
          value={p.yearsToRetirement == null ? "—" : `${p.yearsToRetirement}`}
        />
      </Link>
    </div>
  );
}
