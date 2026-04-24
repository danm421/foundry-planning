import Link from "next/link";
import type { Rollup } from "@/lib/overview/get-asset-allocation-by-type";

const COLORS: Record<string, string> = {
  equities: "bg-blue-500",
  fixed_income: "bg-emerald-500",
  cash: "bg-slate-400",
  real_estate: "bg-amber-500",
  alternatives: "bg-purple-500",
  other: "bg-gray-500",
};

const LABELS: Record<string, string> = {
  equities: "Equities",
  fixed_income: "Fixed Income",
  cash: "Cash",
  real_estate: "Real Estate",
  alternatives: "Alternatives",
  other: "Other",
};

export default function AllocationPanel({
  clientId,
  rollup,
}: {
  clientId: string;
  rollup: Rollup[];
}) {
  if (!rollup.length) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
        <h3 className="mb-2 text-sm font-semibold text-gray-300">Asset allocation</h3>
        <p className="text-sm text-gray-400">No portfolio data yet.</p>
        <Link href={`/clients/${clientId}/client-data`} className="text-sm text-blue-400 underline">
          Add accounts
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
      <h3 className="mb-3 text-sm font-semibold text-gray-300">Asset allocation</h3>
      <div className="flex h-4 overflow-hidden rounded bg-gray-800">
        {rollup.map((r) => (
          <div
            key={r.group}
            className={COLORS[r.group] ?? COLORS.other}
            style={{ width: `${(r.pct * 100).toFixed(2)}%` }}
            title={`${LABELS[r.group] ?? r.group}: ${(r.pct * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {rollup.map((r) => (
            <tr key={r.group} className="border-t border-gray-800">
              <td className="py-1 text-gray-300">{LABELS[r.group] ?? r.group}</td>
              <td className="py-1 text-right text-gray-300">
                ${Math.round(r.value).toLocaleString()}
              </td>
              <td className="py-1 pl-3 text-right text-gray-400">
                {(r.pct * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
