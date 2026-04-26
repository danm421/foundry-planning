import type { ClientData } from "@/engine/types";
import { InEstateColumn } from "./in-estate-column";
import { OutOfEstateColumn } from "./out-of-estate-column";

export function CanvasFrame({ tree }: { tree: ClientData }) {
  const currentYear = new Date().getUTCFullYear();
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <header className="mb-6">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">§01 · Canvas</div>
        <h1 className="mt-1 text-[22px] font-semibold text-[var(--color-ink)]">Estate Planning</h1>
      </header>
      <div className="grid grid-cols-[320px_1fr_360px] gap-0 rounded-[10px] border border-[var(--color-hair)] bg-[var(--color-card)]">
        <div className="border-r border-[var(--color-hair)]">
          <InEstateColumn tree={tree} asOfYear={currentYear} />
        </div>
        <div className="min-h-[480px] flex items-center justify-center text-[var(--color-ink-3)]">
          <span className="text-sm">Death-sequence spine — coming in Plan 3</span>
        </div>
        <div className="border-l border-[var(--color-hair)]">
          <OutOfEstateColumn tree={tree} asOfYear={currentYear} />
        </div>
      </div>
    </div>
  );
}
