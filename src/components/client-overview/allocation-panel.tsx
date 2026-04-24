import Link from "next/link";
import type { ReactElement } from "react";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/card";
import MoneyText from "@/components/money-text";
import SectionMarker from "@/components/section-marker";
import { PieChartIcon } from "@/components/icons";
import EmptyBlock from "./empty-block";
import type { Rollup } from "@/lib/overview/get-asset-allocation-by-type";

interface Props {
  clientId: string;
  rollup: Rollup[];
}

const SWATCH_CLASS: Record<string, string> = {
  equities: "bg-alloc-equities",
  fixed_income: "bg-alloc-fi",
  cash: "bg-alloc-cash",
  real_estate: "bg-alloc-re",
  alternatives: "bg-alloc-alt",
  other: "bg-ink-4",
};

const LABELS: Record<string, string> = {
  equities: "Equities",
  fixed_income: "Fixed Income",
  cash: "Cash",
  real_estate: "Real Estate",
  alternatives: "Alternatives",
  other: "Other",
};

export default function AllocationPanel({ clientId, rollup }: Props): ReactElement {
  if (!rollup.length) {
    return (
      <EmptyBlock
        icon={<PieChartIcon width={22} height={22} />}
        title="No portfolio data yet"
        body="Add accounts on the Client Data tab to populate this block."
        cta={{ href: `/clients/${clientId}/client-data`, label: "Add accounts" }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <SectionMarker num="04" label="Asset allocation" />
          <p className="text-[14px] font-semibold text-ink">Asset allocation</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="flex h-[10px] gap-[2px] overflow-hidden">
          {rollup.map((r, i) => {
            const isFirst = i === 0;
            const isLast = i === rollup.length - 1;
            const radius = isFirst && isLast ? "rounded" : isFirst ? "rounded-l" : isLast ? "rounded-r" : "";
            return (
              <div
                key={r.group}
                className={`${SWATCH_CLASS[r.group] ?? SWATCH_CLASS.other} ${radius}`}
                style={{ width: `${(r.pct * 100).toFixed(2)}%` }}
                title={`${LABELS[r.group] ?? r.group}: ${(r.pct * 100).toFixed(1)}%`}
              />
            );
          })}
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {rollup.map((r) => (
              <tr key={r.group} className="border-t border-hair transition-colors hover:text-ink">
                <td className="py-2 text-ink-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-sm ${SWATCH_CLASS[r.group] ?? SWATCH_CLASS.other}`}
                    />
                    {LABELS[r.group] ?? r.group}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <MoneyText value={r.value} />
                </td>
                <td className="py-2 pl-3 text-right tabular font-mono text-[12px] text-ink-3">
                  {(r.pct * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
      <CardFooter>
        <span>Rolled up from {rollup.length} groups</span>
        <Link href={`/clients/${clientId}/investments`} className="text-accent hover:text-accent-ink">
          Open Investments →
        </Link>
      </CardFooter>
    </Card>
  );
}
