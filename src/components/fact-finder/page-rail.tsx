"use client";
// src/components/fact-finder/page-rail.tsx
// The fact finder's seven pages down the left. Picks the one page the main area
// shows; each carries a dot when it has values and what still needs the advisor.
import type { ReactNode } from "react";
import { PAGE_ORDER, type FFPage } from "@/lib/fact-finder/schema";
import type { PageCounts } from "@/lib/fact-finder/screen-summary";
import { AlertIcon, LinkIcon } from "./icons";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function CountChip({ count, label, tone, children }: { count: number; label: string; tone: string; children: ReactNode }) {
  return (
    <span title={label} className={`inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-[11px] ${tone}`}>
      {children}
      <span aria-hidden="true" className="tabular">
        {count}
      </span>
      <span className="sr-only">, {label}</span>
    </span>
  );
}

interface PageRailProps {
  counts: Record<FFPage, PageCounts>;
  selected: FFPage;
  onSelect: (page: FFPage) => void;
}

export function PageRail({ counts, selected, onSelect }: PageRailProps) {
  return (
    <nav aria-label="Fact finder pages" className="sticky top-[100px]">
      <ul className="flex flex-col gap-1">
        {PAGE_ORDER.map(({ id, label }) => {
          const { hasData, toCheck, toLink } = counts[id];
          const current = id === selected;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                onClick={() => onSelect(id)}
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${
                  current ? "border-accent bg-card-2 text-accent" : "border-transparent text-ink-3 hover:bg-card-2 hover:text-ink-2"
                }`}
              >
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasData ? "bg-ink-3" : ""}`} />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {hasData && <span className="sr-only">, has values</span>}
                {toCheck > 0 && (
                  <CountChip count={toCheck} label={plural(toCheck, "value to check", "values to check")} tone="border-warn/30 bg-warn/15 text-warn">
                    <AlertIcon className="h-3 w-3" />
                  </CountChip>
                )}
                {toLink > 0 && (
                  <CountChip count={toLink} label={plural(toLink, "link to confirm", "links to confirm")} tone="border-hair-2 bg-card text-ink-2">
                    <LinkIcon className="h-3 w-3" />
                  </CountChip>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
