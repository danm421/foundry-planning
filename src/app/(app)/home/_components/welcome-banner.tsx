"use client";

import Link from "next/link";
import type { ReactElement } from "react";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function WelcomeBanner({ firstName }: { firstName: string | null }): ReactElement {
  const now = new Date();
  return (
    <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {/* Server renders at server-local hour; the client corrects on
            hydration. Text-only mismatch — suppress the warning. */}
        <h1 className="text-2xl font-semibold text-ink" suppressHydrationWarning>
          {greetingForHour(now.getHours())}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-ink-3 tabular" suppressHydrationWarning>
          {DATE_FMT.format(now)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/crm/new"
          className="rounded border border-hair bg-card px-3 py-1.5 text-sm text-ink hover:bg-paper"
        >
          + New household
        </Link>
        <Link
          href="/tasks?new=1"
          className="rounded border border-hair bg-card px-3 py-1.5 text-sm text-ink hover:bg-paper"
        >
          + New task
        </Link>
        <Link
          href="/data-collection"
          className="rounded border border-hair bg-card px-3 py-1.5 text-sm text-ink hover:bg-paper"
        >
          Send intake
        </Link>
      </div>
    </section>
  );
}
