import Link from "next/link";
import { SuccessGauge } from "@/components/monte-carlo/success-gauge";
import NetWorthSparkline from "./net-worth-sparkline";

type Props = {
  clientId: string;
  monteCarloSuccess: number | null; // 0..1
  netWorthSeries: number[];
};

export default function RunwayPanel({ clientId, monteCarloSuccess, netWorthSeries }: Props) {
  if (monteCarloSuccess == null && netWorthSeries.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
        <p className="text-sm text-gray-400">No projection yet.</p>
        <Link href={`/clients/${clientId}/cashflow`} className="text-sm text-blue-400 underline">
          Run a projection
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
      <h3 className="mb-3 text-sm font-semibold text-gray-300">Retirement runway</h3>
      <div className="flex items-center gap-6">
        <Link href={`/clients/${clientId}/monte-carlo`}>
          {monteCarloSuccess != null && <SuccessGauge value={monteCarloSuccess} />}
        </Link>
        <Link href={`/clients/${clientId}/cashflow`} className="flex-1 text-blue-300">
          <NetWorthSparkline values={netWorthSeries} />
          <p className="mt-1 text-xs text-gray-500">Net worth over plan</p>
        </Link>
      </div>
    </div>
  );
}
