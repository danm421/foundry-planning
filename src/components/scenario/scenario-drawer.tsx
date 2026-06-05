"use client";

import { useEffect } from "react";
import { ChangesPanel, type ChangesPanelProps } from "./changes-panel";
import { useScenarioDrawer } from "./scenario-drawer-provider";

/**
 * Right-edge slide-out that hosts <ChangesPanel> on every non-Details scenario
 * page. Overlays the page (does NOT reflow it) and has no backdrop — the page
 * stays interactive and updates live as changes are toggled. Open/closed comes
 * from <ScenarioDrawerProvider>. Only ever mounted (by ScenarioDrawerShell)
 * when a non-base scenario is active, so the handle implies "scenario mode".
 */
export function ScenarioDrawer(props: ChangesPanelProps) {
  const { open, toggle, setOpen } = useScenarioDrawer();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <div
      id="scenario-changes-drawer"
      // z-30 == the left nav: above page content, below the sticky topbar
      // (z-40) and client header (z-[35]) so tabs + scenario pill stay clickable.
      className="fixed right-0 top-[100px] z-30 h-[calc(100vh-100px)]"
      style={{
        width: 360,
        transform: open ? "translateX(0)" : "translateX(360px)",
        transition: "transform 0.22s ease",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="scenario-changes-drawer"
        aria-label={open ? "Hide changes" : "Show changes"}
        title={open ? "Hide changes" : "Show changes"}
        className="absolute -left-7 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-md border border-r-0 border-hair bg-card px-1.5 py-3 text-ink-2 shadow-[-2px_0_6px_rgba(0,0,0,0.06)] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden="true" className="text-sm leading-none">
          {open ? "›" : "‹"}
        </span>
        <span className="rotate-180 font-mono text-[10px] uppercase tracking-[0.18em] text-accent [writing-mode:vertical-rl]">
          Changes
        </span>
        <span className="text-[11px] tabular-nums leading-none">
          {props.changes.length}
        </span>
      </button>
      {/* inert when closed: the off-screen panel's toggles stay out of the tab
          order / AT tree, but the handle (outside this wrapper) stays operable. */}
      <div className="h-full" inert={open ? undefined : true}>
        <ChangesPanel {...props} className="h-full" />
      </div>
    </div>
  );
}
