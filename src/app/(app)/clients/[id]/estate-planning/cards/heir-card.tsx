"use client";

import { useState } from "react";
import type { HeirCardData, BequestSummaryRow } from "../lib/derive-card-data";

interface Props {
  data: HeirCardData;
  defaultExpanded?: boolean;
}

export function HeirCard({ data, defaultExpanded = false }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const initial = data.name.charAt(0).toUpperCase();
  const count = data.bequestsReceived.length;

  return (
    <div className="border-b border-[var(--color-hair)] last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[var(--color-card-hover)]"
      >
        <div
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-card-2)] text-[12px] font-semibold text-[var(--color-ink-2)]"
        >
          {initial}
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold leading-tight text-[var(--color-ink)]">{data.name}</span>
          <span className="text-xs text-[var(--color-ink-3)]">
            {data.relationship}{data.age != null ? ` · Age ${data.age}` : ""}
          </span>
        </div>
        <div className="ml-auto text-xs text-[var(--color-ink-3)]">
          {count} bequest{count === 1 ? "" : "s"}
        </div>
        <span aria-hidden className={`ml-2 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="bg-[var(--color-card-2)] px-5 py-3">
          {count === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--color-hair-2)] px-3 py-3 text-center text-xs text-[var(--color-ink-3)]">
              Drop assets to bequeath
            </div>
          ) : (
            <ul className="flex flex-col">
              {data.bequestsReceived.map((b) => <BequestRow key={b.bequestId} bequest={b} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BequestRow({ bequest }: { bequest: BequestSummaryRow }) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-[12px]">
      <span className="truncate text-[var(--color-ink-2)]">{bequest.assetName}</span>
      {bequest.condition !== "always" && (
        <span className="rounded-sm bg-[var(--color-card)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-ink-3)]">
          {bequest.condition}
        </span>
      )}
      <span className="ml-auto tabular-nums text-[var(--color-ink)]">{bequest.percentage}%</span>
    </li>
  );
}
