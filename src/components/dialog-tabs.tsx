"use client";

export interface DialogTab {
  id: string;
  label: string;
}

interface DialogTabsProps {
  tabs: DialogTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export default function DialogTabs({ tabs, activeTab, onTabChange }: DialogTabsProps) {
  return (
    <div className="flex items-stretch border-b border-hair px-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={
              "px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] border-b-2 -mb-px transition-colors " +
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
  );
}
