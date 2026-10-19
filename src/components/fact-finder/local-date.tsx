"use client";
// src/components/fact-finder/local-date.tsx
// A date in the browser's own timezone ("October 14, 2026"). The server can't
// know it, so the server's render — and the browser's hydrating one — show no
// date, and it appears as soon as the page runs in the browser: never the
// server's UTC date, a day off in the evening.
import { useSyncExternalStore } from "react";

const nothingToWatch = () => () => {};

export function LocalDate({ iso }: { iso: string }) {
  const date = useSyncExternalStore(
    nothingToWatch,
    () => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    () => null,
  );
  return (
    <time dateTime={iso} className="tabular">
      {date}
    </time>
  );
}
