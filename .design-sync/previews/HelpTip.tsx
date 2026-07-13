import { HelpTip } from "foundry-planning";
import { useEffect, useRef, type ReactNode } from "react";

function Canvas({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper text-ink font-sans p-6" style={{ width: 340, minHeight: 140 }}>
      {children}
    </div>
  );
}

function LabeledTip() {
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
      <span>Effective tax rate</span>
      <HelpTip text="Total federal + state tax divided by gross income for the current plan year." />
    </div>
  );
}

export function Closed() {
  return (
    <Canvas>
      <LabeledTip />
    </Canvas>
  );
}

/** Clicks the real HelpTip button on mount so the tooltip is open for the shot. */
function AutoOpen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

export function Open() {
  return (
    <Canvas>
      <AutoOpen>
        <LabeledTip />
      </AutoOpen>
    </Canvas>
  );
}

export function InContext() {
  return (
    <Canvas>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-2">
          Auto-derived deductions
        </h3>
        <HelpTip text="Pulled automatically from your savings, expenses, mortgages, and real-estate data. Edit on their respective tabs." />
      </div>
      <p className="text-[13px] text-ink-3">$42,180 across 4 categories.</p>
    </Canvas>
  );
}
