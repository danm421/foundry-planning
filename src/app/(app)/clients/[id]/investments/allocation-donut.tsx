"use client";

import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { colorForAssetClass, UNALLOCATED_COLOR } from "@/lib/investments/palette";
import type { HouseholdAllocation } from "@/lib/investments/allocation";

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  household: HouseholdAllocation;
}

export default function AllocationDonut({ household }: Props) {
  const rows = [
    ...household.byAssetClass.map((b) => ({
      label: b.name,
      value: b.value,
      color: colorForAssetClass({ sortOrder: b.sortOrder }),
    })),
    ...(household.unallocatedValue > 0
      ? [{ label: "Unallocated", value: household.unallocatedValue, color: UNALLOCATED_COLOR }]
      : []),
  ];

  const data = {
    labels: rows.map((r) => r.label),
    datasets: [
      {
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.color),
        borderColor: "#111827", // gray-900
        borderWidth: 2,
      },
    ],
  };

  const options = {
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { label: string; parsed: number }) =>
            `${ctx.label}: $${ctx.parsed.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        },
      },
    },
    cutout: "62%",
    maintainAspectRatio: true,
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">Investable Total</div>
      <div className="text-2xl font-bold text-gray-100">
        ${household.totalInvestableValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </div>
      <div className="h-64 w-64">
        <Doughnut data={data} options={options} />
      </div>
    </div>
  );
}
