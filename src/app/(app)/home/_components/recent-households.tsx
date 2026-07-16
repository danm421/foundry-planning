import Link from "next/link";
import type { ReactElement } from "react";
import { Card, CardHeader } from "@/components/card";
import type { RecentHousehold } from "@/lib/home/types";

export function RecentHouseholds({
  households,
}: {
  households: RecentHousehold[];
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-ink">Recently opened</h2>
        <Link href="/clients" className="text-xs text-ink-3 hover:text-ink">
          All clients
        </Link>
      </CardHeader>
      {households.length === 0 ? (
        <p className="px-[var(--pad-card)] py-4 text-sm text-ink-3">
          Households you open will show up here.
        </p>
      ) : (
        <ul className="px-2 py-2">
          {households.map((h) => (
            <li key={h.id}>
              <Link
                href={`/crm/households/${h.id}`}
                className="flex items-center justify-between gap-2 rounded px-2 py-2 hover:bg-paper"
              >
                <span className="truncate text-sm text-ink">{h.name}</span>
                <span className="shrink-0 text-xs capitalize text-ink-3">{h.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
