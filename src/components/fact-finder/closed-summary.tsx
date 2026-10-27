"use client";
// src/components/fact-finder/closed-summary.tsx
// What a finished import lists under its banner, read-only: each record that
// went to the plan, linked to the Details page that shows it, and each line
// left out, with why. It's the whole record of the import — one closed by the
// Claude connector, or before the chat existed, has no chat turn saying it.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/card";
import { detailsHrefFor } from "@/lib/fact-finder/record-links";
import type { FFClosed } from "@/lib/fact-finder/types";

const ITEM = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-[var(--pad-card)] py-2.5 text-sm";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h3 className="border-b border-hair px-[var(--pad-card)] py-3 text-sm font-semibold text-ink-2">{title}</h3>
      <ul aria-label={title} className="divide-y divide-hair">
        {children}
      </ul>
    </Card>
  );
}

export function ClosedSummary({ clientId, closed }: { clientId: string; closed: FFClosed }) {
  const { saved, leftOut } = closed;
  if (saved.length === 0 && leftOut.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {saved.length > 0 && (
        <Group title="Saved to the plan">
          {saved.map((line) => (
            <li key={line.lineId} className={ITEM}>
              <Link
                href={detailsHrefFor(clientId, line.target)}
                className="font-medium text-ink underline underline-offset-2 hover:no-underline"
              >
                {line.label}
              </Link>
            </li>
          ))}
        </Group>
      )}
      {leftOut.length > 0 && (
        <Group title="Left out">
          {leftOut.map((line) => (
            <li key={line.lineId} className={ITEM}>
              <span className="font-medium text-ink">{line.label}</span>
              <span className="text-ink-3">{line.reason}</span>
            </li>
          ))}
        </Group>
      )}
    </div>
  );
}
