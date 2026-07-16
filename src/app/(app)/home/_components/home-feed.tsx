import Link from "next/link";
import type { ReactElement } from "react";
import { Card, CardHeader } from "@/components/card";
import type { FeedItem, HomeFeed } from "@/lib/home/types";

const WHEN_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function FeedRow({ item }: { item: FeedItem }): ReactElement {
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-baseline justify-between gap-3 rounded px-2 py-2 hover:bg-paper"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm text-ink">
            {item.overdue && (
              <span className="mr-1.5 text-xs font-medium text-crit">Overdue</span>
            )}
            {item.title}
          </span>
          {item.subtitle && (
            <span className="block truncate text-xs text-ink-3">{item.subtitle}</span>
          )}
        </span>
        <span className="shrink-0 text-xs tabular text-ink-3">
          {WHEN_FMT.format(item.when)}
        </span>
      </Link>
    </li>
  );
}

function Group({
  title,
  items,
  empty,
}: {
  title: string;
  items: FeedItem[];
  empty: string;
}): ReactElement {
  return (
    <div className="px-[var(--pad-card)] py-3">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3 tabular">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="py-2 text-sm text-ink-3">{empty}</p>
      ) : (
        <ul className="-mx-2">
          {items.map((i) => (
            <FeedRow key={i.id} item={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function HomeFeedCard({ feed }: { feed: HomeFeed }): ReactElement {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-ink">Your feed</h2>
        <Link href="/tasks" className="text-xs text-ink-3 hover:text-ink">
          View all tasks
        </Link>
      </CardHeader>
      <Group
        title="Coming up"
        items={feed.comingUp}
        empty="Nothing due in the next few weeks."
      />
      <div className="border-t border-hair" />
      <Group
        title="Recent"
        items={feed.recent}
        empty="No recent activity in the last two weeks."
      />
    </Card>
  );
}
