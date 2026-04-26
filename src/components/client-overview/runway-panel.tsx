import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/card";
import MoneyText from "@/components/money-text";
import SectionMarker from "@/components/section-marker";
import { ChartLineIcon } from "@/components/icons";
import EmptyBlock from "./empty-block";
import MetaPill from "./meta-pill";
import NetWorthSparkline from "./net-worth-sparkline";

interface Props {
  clientId: string;
  gaugeSlot: ReactNode;
  netWorthSeries: number[];
  startYear?: number;
}

export default function RunwayPanel({
  clientId,
  gaugeSlot,
  netWorthSeries,
  startYear,
}: Props): ReactElement {
  if (netWorthSeries.length === 0) {
    return (
      <EmptyBlock
        icon={<ChartLineIcon width={22} height={22} />}
        title="No projection yet"
        body="Run the cash-flow projection to populate this block."
        cta={{ href: `/clients/${clientId}/cashflow`, label: "Run a projection" }}
      />
    );
  }

  const peak = netWorthSeries.length ? Math.max(...netWorthSeries) : null;
  const planEnd = netWorthSeries.length ? netWorthSeries[netWorthSeries.length - 1] : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <SectionMarker num="03" label="Retirement runway" />
          <p className="text-[14px] font-semibold text-ink">
            Retirement runway{" "}
            <span className="text-[12.5px] font-normal text-ink-3">
              · 30-year projection
            </span>
          </p>
        </div>
        <MetaPill label="30-yr projection" active />
      </CardHeader>
      <CardBody className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
        {gaugeSlot}
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex gap-6">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-xs uppercase tracking-[0.08em] text-ink-4">
                Peak
              </span>
              <MoneyText value={peak} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-xs uppercase tracking-[0.08em] text-ink-4">
                Plan end
              </span>
              <MoneyText value={planEnd} />
            </div>
          </div>
          <NetWorthSparkline values={netWorthSeries} startYear={startYear} />
        </div>
      </CardBody>
      <CardFooter>
        <span>
          Monte Carlo · {netWorthSeries.length ? "10,000 trials" : "awaiting run"}
        </span>
        <Link href={`/clients/${clientId}/monte-carlo`} className="text-accent hover:text-accent-ink">
          Open Monte Carlo →
        </Link>
      </CardFooter>
    </Card>
  );
}
