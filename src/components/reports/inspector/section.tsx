import type { ReactNode } from "react";

export function InspectorSection({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <section className="border-t border-hair px-4 py-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-3">{eyebrow}</div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
