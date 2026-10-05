// src/components/forge/forge-tabs.tsx
"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ForgeTab } from "./forge-provider";

const TABS: { id: ForgeTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "hub", label: "Knowledge Hub" },
];

const tabId = (t: ForgeTab) => `forge-tab-${t}`;
const panelId = (t: ForgeTab) => `forge-tabpanel-${t}`;

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
            id={tabId(t.id)}
            aria-selected={selected}
            aria-controls={panelId(t.id)}
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

/** One view's panel. Hidden, not unmounted, while the other tab shows
 *  (Tailwind's preflight makes `hidden` win over `flex`). */
export function ForgeTabPanel({ id, tab, children }: { id: ForgeTab; tab: ForgeTab; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={tab !== id} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}
