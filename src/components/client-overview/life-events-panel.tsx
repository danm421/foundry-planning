import Link from "next/link";
import type { ReactElement } from "react";
import { Card, CardBody, CardHeader } from "@/components/card";
import SectionMarker from "@/components/section-marker";
import { CalendarIcon } from "@/components/icons";
import EmptyBlock from "./empty-block";

type Event = { year: number; label: string };

interface Props {
  clientId: string;
  events: Event[];
}

export default function LifeEventsPanel({ clientId, events }: Props): ReactElement {
  if (!events.length) {
    return (
      <EmptyBlock
        icon={<CalendarIcon width={22} height={22} />}
        title="Add a retirement year to populate"
        body="Life events are derived from retirement ages, Social Security claim ages, RMD years, and life expectancy."
        cta={{ href: `/clients/${clientId}/client-data`, label: "Edit client details" }}
      />
    );
  }

  const sorted = [...events].sort((a, b) => a.year - b.year);
  const minYear = sorted[0].year;
  const maxYear = sorted[sorted.length - 1].year;
  const span = Math.max(maxYear - minYear, 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <SectionMarker num="05" label="Life events timeline" />
          <p className="text-[14px] font-semibold text-ink">Life events timeline</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="relative h-[120px] w-full">
          {/* Axis line */}
          <div className="absolute left-0 right-0 top-1/2 h-px bg-hair" />
          {/* End-year pills */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 rounded-sm border border-hair bg-card-2 px-2 py-0.5 font-mono text-xs text-ink-3">
            {minYear}
          </div>
          <div className="absolute right-0 top-1/2 -translate-y-1/2 rounded-sm border border-hair bg-card-2 px-2 py-0.5 font-mono text-xs text-ink-3">
            {maxYear}
          </div>
          {/* Events */}
          {sorted.map((e, i) => {
            const leftPct = ((e.year - minYear) / span) * 100;
            const above = i % 2 === 0;
            return (
              <Link
                key={`${e.year}-${i}`}
                href={`/clients/${clientId}/cashflow/timeline#y${e.year}`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${leftPct}%` }}
                title={`${e.year} · ${e.label}`}
              >
                <span className="block h-2.5 w-2.5 rounded-full bg-ink-3" />
                <span
                  className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs ${
                    above
                      ? "-top-8 rounded-sm border border-hair bg-card-2 px-1.5 py-0.5 text-ink-2"
                      : "top-4 text-ink-4 italic"
                  }`}
                >
                  {e.year} · {e.label}
                </span>
              </Link>
            );
          })}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-2 border-t border-hair pt-3">
          <span className="inline-block h-2 w-2 rounded-full bg-ink-3" />
          <span className="text-xs text-ink-4">Life event</span>
        </div>
      </CardBody>
    </Card>
  );
}
