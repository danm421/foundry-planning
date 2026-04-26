import Link from "next/link";
import type { ReactElement } from "react";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/card";
import SectionMarker from "@/components/section-marker";
import type { OpenItemRow } from "@/lib/overview/list-open-items";

interface Props {
  clientId: string;
  items: OpenItemRow[];
  totalOpen: number;
  totalCompleted: number;
}

const PRIORITY_CHIP: Record<string, string> = {
  high: "text-crit bg-crit/12",
  medium: "text-warn bg-warn/12",
  low: "text-ink-3 bg-card-2",
};

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate) < today;
}

function formatDate(d: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(d));
}

export default function OpenItemsPreview({
  clientId,
  items,
  totalOpen,
  totalCompleted,
}: Props): ReactElement {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <SectionMarker num="06" label="Open items preview" />
          <p className="text-[14px] font-semibold text-ink">Open items</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col">
        {items.length === 0 ? (
          <p className="text-[13px] text-ink-3">No open items.</p>
        ) : (
          items.map((i, idx) => {
            const overdue = isOverdue(i.dueDate);
            return (
              <div
                key={i.id}
                className={`flex items-center gap-3 py-2 text-[13px] ${
                  idx > 0 ? "border-t border-hair" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block h-[15px] w-[15px] rounded-full border border-hair-2"
                />
                <span className="flex-1 text-ink-2">{i.title}</span>
                <span
                  className={`rounded-sm px-1.5 py-[2px] font-mono text-xs uppercase ${
                    PRIORITY_CHIP[i.priority] ?? PRIORITY_CHIP.low
                  }`}
                >
                  {i.priority}
                </span>
                {i.dueDate && (
                  <span
                    className={`tabular font-mono text-xs ${
                      overdue ? "font-semibold text-crit" : "text-ink-4"
                    }`}
                  >
                    {overdue ? "Overdue · " : ""}
                    {formatDate(i.dueDate)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </CardBody>
      <CardFooter>
        <span className="tabular">
          {totalOpen} open · {totalCompleted} completed
        </span>
        <Link
          href={`/clients/${clientId}/client-data`}
          className="text-accent hover:text-accent-ink"
        >
          Manage on Details →
        </Link>
      </CardFooter>
    </Card>
  );
}
