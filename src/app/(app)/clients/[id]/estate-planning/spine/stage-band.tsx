"use client";

import { useState, type ReactNode } from "react";
import MoneyText from "@/components/money-text";

type Kind = "tax" | "inherit" | "trusts" | "heirs";

const PALETTE: Record<Kind, string> = {
  tax: "bg-tax/20 text-ink",
  inherit: "bg-inherit/20 text-ink",
  trusts: "bg-accent/15 text-ink",
  heirs: "bg-heirs/20 text-ink",
};

export function StageBand({
  kind,
  label,
  value,
  expansion,
  defaultExpanded = false,
}: {
  kind: Kind;
  label: string;
  value: number;
  /** When provided, the band becomes a button that toggles the expansion content. */
  expansion?: ReactNode;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const palette = PALETTE[kind];
  const isExpandable = expansion != null;

  return (
    <div className={`rounded my-2 ${palette}`}>
      <button
        type="button"
        aria-expanded={isExpandable ? open : undefined}
        onClick={() => isExpandable && setOpen((o) => !o)}
        disabled={!isExpandable}
        className="flex w-full items-center justify-between p-3 text-left disabled:cursor-default"
      >
        <span className="text-[12px] uppercase tracking-wider">{label}</span>
        <span className="flex items-center gap-2">
          <MoneyText value={value} className="font-mono tabular-nums" />
          {isExpandable && (
            <span aria-hidden className={`transition-transform text-xs ${open ? "rotate-90" : ""}`}>
              ▸
            </span>
          )}
        </span>
      </button>
      {isExpandable && open && (
        <div className="bg-card-2/40 border-t border-hair px-3 py-3">{expansion}</div>
      )}
    </div>
  );
}
