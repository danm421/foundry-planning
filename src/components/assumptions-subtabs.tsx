"use client";

interface Tab {
  id: string;
  label: string;
}

interface AssumptionsSubtabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export default function AssumptionsSubtabs({ tabs, activeTab, onTabChange }: AssumptionsSubtabsProps) {
  return (
    <div className="flex gap-1 border-b border-hair pb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? "bg-card-2 text-ink"
              : "text-ink-3 hover:bg-card-2/50 hover:text-ink-2"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
