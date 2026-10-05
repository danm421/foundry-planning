// src/components/forge/forge-tabs.tsx
"use client";

import { useRef, type KeyboardEvent } from "react";
import type { ForgeTab } from "./forge-provider";

const TABS: { id: ForgeTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "hub", label: "Knowledge Hub" },
];

/** Chat | Knowledge Hub. Styled like DialogTabs; adds the ARIA tab pattern
 *  (roving tabindex, arrow keys) that DialogTabs doesn't have. */
export function ForgeTabs({ tab, onChange }: { tab: ForgeTab; onChange: (t: ForgeTab) => void }) {
  const refs = useRef<Partial<Record<ForgeTab, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: ForgeTab = tab === "chat" ? "hub" : "chat";
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Forge views" onKeyDown={onKeyDown} className="flex items-stretch border-b border-hair-2 px-2">
      {TABS.map((t) => {
        const selected = t.id === tab;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`forge-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`forge-tabpanel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={
              "-mb-px border-b-2 px-4 py-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150 " +
              (selected ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
