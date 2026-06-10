import Link from "next/link";
import type { ReactElement } from "react";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/card";
import MoneyText from "@/components/money-text";
import { ChartLineIcon } from "@/components/icons";
import { liquidPortfolioTotal } from "@/components/charts/portfolio-bars-data";
import type { ProjectionYear } from "@/engine";
import EmptyBlock from "./empty-block";
import PanelHeading from "./panel-heading";
import PortfolioGrowthChart from "./portfolio-growth-chart";

interface Props {
  clientId: string;
  projection: ProjectionYear[];
}

export default function PortfolioGrowthPanel({
  clientId,
  projection,
}: Props): ReactElement {
  if (projection.length === 0) {
    return (
      <EmptyBlock
        icon={<ChartLineIcon width={22} height={22} />}
        title="No projection yet"
        body="Run the cash-flow projection to see how portfolio assets grow over time."
        cta={{ href: `/clients/${clientId}/cashflow`, label: "Run a projection" }}
      />
    );
  }

  const totals = projection.map((y) => liquidPortfolioTotal(y));
  const start = totals[0];
  const peak = Math.max(...totals);
  const startYear = projection[0].year;
  const endYear = projection[projection.length - 1].year;

  return (
    <Card>
      <CardHeader>
        <PanelHeading
          icon={<ChartLineIcon width={16} height={16} />}
          title="Liquid portfolio growth"
          meta={`${startYear}–${endYear}`}
        />
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="flex gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-ink-4">
              Today
            </span>
            <MoneyText value={start} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-ink-4">
              Peak
            </span>
            <MoneyText value={peak} />
          </div>
        </div>
        <PortfolioGrowthChart years={projection} />
      </CardBody>
      <CardFooter>
        <span>{projection.length}-year projection</span>
        <Link
          href={`/clients/${clientId}/cashflow`}
          className="text-accent hover:text-accent-ink"
        >
          Open Cash Flow →
        </Link>
      </CardFooter>
    </Card>
  );
}
