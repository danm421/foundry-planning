"use client";

import { useState } from "react";
import NetWorthBoard from "./net-worth-board";
import GoalsBoard from "./goals-board";
import CashFlowBoard from "./cash-flow-board";
import type { HouseholdMapProps } from "@/lib/household-map/types";

const BOARDS = [
  { key: "net-worth", label: "Net Worth" },
  { key: "goals", label: "Goals" },
  { key: "cash-flow", label: "Cash Flow" },
] as const;

export default function HouseholdMapView(props: HouseholdMapProps) {
  const [board, setBoard] = useState<(typeof BOARDS)[number]["key"]>("net-worth");

  return (
    <div className="rounded-xl border border-hair bg-card p-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="inline-flex gap-1" role="tablist" aria-label="Household Map boards">
          {BOARDS.map((b) => (
            <button
              key={b.key}
              role="tab"
              aria-selected={board === b.key}
              onClick={() => setBoard(b.key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                board === b.key
                  ? "border-accent bg-card-2 text-accent"
                  : "border-hair text-ink-3 hover:text-ink-2"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <span className="rounded-md bg-card-2 px-3 py-1.5 text-xs font-semibold text-ink">
          Net Worth · {props.netWorthLabel}
        </span>
      </div>

      {board === "net-worth" && <NetWorthBoard {...props} />}
      {board === "goals" && <GoalsBoard {...props} />}
      {board === "cash-flow" && <CashFlowBoard {...props} />}
    </div>
  );
}
