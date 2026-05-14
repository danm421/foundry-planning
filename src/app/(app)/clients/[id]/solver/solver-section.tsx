"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type SolverSide = "base" | "working";
const SolverSideContext = createContext<SolverSide>("base");

export function useSolverSide(): SolverSide {
  return useContext(SolverSideContext);
}

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SolverSection({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-hair first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group w-full flex items-center gap-2 px-5 h-11 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3 bg-card-2/60 hover:bg-card-hover hover:text-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={`h-3 w-3 shrink-0 text-ink-4 transition-transform duration-150 ease-out group-hover:text-ink-3 ${
            open ? "rotate-90" : ""
          }`}
        >
          <path
            d="M4 2.5 8 6 4 9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{title}</span>
      </button>
      {open ? (
        <div className="grid grid-cols-2 divide-x divide-hair">
          <SideGrid side="base">{children}</SideGrid>
          <SideGrid side="working">{children}</SideGrid>
        </div>
      ) : null}
    </div>
  );
}

function SideGrid({ side, children }: { side: SolverSide; children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-5 px-5 py-4 auto-rows-max content-start">
      <SolverSideContext.Provider value={side}>{children}</SolverSideContext.Provider>
    </div>
  );
}
