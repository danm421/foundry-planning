"use client";

import { useState } from "react";
import MoneyText from "@/components/money-text";
import type { ClientCardData, AssetRow } from "../lib/derive-card-data";

interface Props {
  data: ClientCardData;
  defaultExpanded?: boolean;
}

export function ClientCard({ data, defaultExpanded = false }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const total = data.outrightTotal + data.jointHalfTotal;
  const initial = data.name.charAt(0).toUpperCase();

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
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-card-2)] text-[14px] font-semibold text-[var(--color-ink)]"
        >
          {initial}
        </div>
        <div className="flex flex-col">
          <span className="text-[14px] font-semibold leading-tight text-[var(--color-ink)]">{data.name}</span>
          <span className="text-xs text-[var(--color-ink-3)]">{data.ageDescriptor}</span>
        </div>
        <div className="ml-auto flex flex-col items-end">
          <MoneyText value={total} className="text-[15px] font-semibold tabular-nums" />
          <span className="text-[10.5px] text-[var(--color-ink-3)]">solo + ½ joint</span>
        </div>
        <span aria-hidden className={`ml-2 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="bg-[var(--color-card-2)] px-5 py-3">
          {data.outrightAssets.length > 0 && (
            <Section title="Owned outright" assets={data.outrightAssets} kind="outright" />
          )}
          {data.jointAssets.length > 0 && (
            <Section title="Jointly held" assets={data.jointAssets} kind="joint-locked" />
          )}
          <div className="mt-3 flex justify-between text-xs text-[var(--color-ink-3)]">
            <span>{data.outrightAssets.length + data.jointAssets.length} assets</span>
            <MoneyText value={total} className="tabular-nums" />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  assets,
  kind,
}: {
  title: string;
  assets: AssetRow[];
  kind: "outright" | "joint-locked";
}) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        <span>{title}</span>
        <span className="h-px flex-1 bg-[var(--color-hair)]" />
      </div>
      <ul className="mt-1.5 flex flex-col">
        {assets.map((a) => (
          <li
            key={a.id}
            data-row-kind={kind}
            className={`flex items-center gap-2 py-1.5 text-[12px] ${
              kind === "joint-locked" ? "opacity-[0.72]" : "cursor-grab hover:text-[var(--color-ink)]"
            }`}
          >
            <span className="h-1.5 w-1.5 shrink-0 bg-[var(--color-cat-portfolio)]" aria-hidden />
            <span className="truncate text-[var(--color-ink-2)]">{a.name}</span>
            {a.tag && (
              <span className="rounded-sm bg-[var(--color-card)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
                {a.tag}
              </span>
            )}
            {kind === "joint-locked" && (
              <span aria-hidden className="text-[var(--color-ink-3)]" title="Jointly held — allocate before moving">
                ⇋
              </span>
            )}
            <MoneyText value={a.value} className="ml-auto tabular-nums text-[var(--color-ink)]" />
          </li>
        ))}
      </ul>
    </div>
  );
}
