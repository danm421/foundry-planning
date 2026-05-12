"use client";

import type { ReactNode } from "react";

export interface DialogTab {
  id: string;
  label: string;
}

interface DialogTabsProps {
  tabs: DialogTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Rendered flush-right on the tab row. Used by auto-save dialogs for the
   *  "Saving…" indicator / error chip. */
  right?: ReactNode;
}

export default function DialogTabs({ tabs, activeTab, onTabChange, right }: DialogTabsProps) {
  return (
    <div className="flex items-stretch justify-between border-b border-hair px-2">
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={
                "px-4 py-3 text-xs font-medium uppercase tracking-[0.08em] border-b-2 -mb-px transition-colors " +
                (isActive
                  ? "text-accent-ink border-accent"
                  : "text-ink-3 hover:text-ink-2 border-transparent")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {right && <div className="flex items-center pr-2">{right}</div>}
    </div>
  );
}
