"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type SolverSide = "base" | "working";
export const SolverSideContext = createContext<SolverSide>("base");

export function useSolverSide(): SolverSide {
  return useContext(SolverSideContext);
}

/** Renders children only in the working (right) column. `SolverSection` paints
 *  its children once per side, so editing-only controls (add account, solve)
 *  must opt out of the read-only base column. */
export function SolverWorkingOnly({ children }: { children: ReactNode }) {
  return useSolverSide() === "working" ? <>{children}</> : null;
}

interface Props {
  title: string;
  defaultOpen?: boolean;
  /** Optional control rendered on the right side of the section header
   *  (e.g. an "Add" button for the techniques tab). */
  action?: ReactNode;
  children: ReactNode;
}

export function SolverSection({ title, defaultOpen = true, action, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-hair first:border-t-0">
      <div className="group flex items-center gap-2 pr-5 bg-card-2/60 hover:bg-card-hover transition-colors">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 px-5 h-11 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3 group-hover:text-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
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
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {open ? (
        <div className="px-5 py-4">
          <SolverSideContext.Provider value="working">
            <div className="grid grid-cols-1 gap-y-5 auto-rows-max content-start">{children}</div>
          </SolverSideContext.Provider>
        </div>
      ) : null}
    </div>
  );
}
