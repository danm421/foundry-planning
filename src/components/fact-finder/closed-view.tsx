"use client";
// src/components/fact-finder/closed-view.tsx
// What a saved import shows above its (read-only) fact finder: when it was
// saved, each record that went to the plan with a link to the Details page that
// shows it, and each line that didn't, with why.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/card";
import { detailsHrefFor } from "@/lib/fact-finder/record-links";
import type { FFClosed } from "@/lib/fact-finder/types";
import { CircleCheckIcon } from "./icons";

const LIST = "divide-y divide-hair";
const ITEM = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-[var(--pad-card)] py-2.5 text-sm";

function Group({ title, name, children }: { title: string; name: string; children: React.ReactNode }) {
  return (
    <Card>
      <h3 className="border-b border-hair px-[var(--pad-card)] py-3 text-sm font-semibold text-ink-2">{title}</h3>
      <ul aria-label={name} className={LIST}>
        {children}
      </ul>
    </Card>
  );
}

/** `justSaved`: the save landed on this screen — bring the summary into view and give it focus (the Save button is gone). */
export function ClosedView({ clientId, closed, justSaved = false }: { clientId: string; closed: FFClosed; justSaved?: boolean }) {
  const { saved, leftOut } = closed;
  const summaryRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!justSaved) return;
    summaryRef.current?.scrollIntoView?.({ block: "center" });
    summaryRef.current?.focus({ preventScroll: true });
  }, [justSaved]);
  // The browser's own timezone, so the server's render may differ by a day near midnight.
  const date = new Date(closed.at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-2 px-[var(--pad-card)] py-4">
        <CircleCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good" />
        <p ref={summaryRef} role="status" tabIndex={-1} className="text-sm text-ink rounded-[var(--radius-sm)] focus:outline-2 focus:outline-offset-2 focus:outline-accent">
          Saved to the plan on{" "}
          <time dateTime={closed.at} suppressHydrationWarning className="tabular">
            {date}
          </time>{" "}
          — <span className="tabular">{saved.length}</span> saved, <span className="tabular">{leftOut.length}</span> left out
        </p>
      </Card>
      <p className="text-sm text-ink-3">This import is saved. Change the plan on its Details pages, or start a new import.</p>
      <Group title="Saved to the plan" name="Saved to the plan">
        {saved.map((line) => (
          <li key={line.lineId} className={ITEM}>
            <Link href={detailsHrefFor(clientId, line.target)} className="font-medium text-ink underline underline-offset-2 hover:no-underline">
              {line.label}
            </Link>
          </li>
        ))}
      </Group>
      {leftOut.length > 0 && (
        <Group title="Left out" name="Left out">
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
