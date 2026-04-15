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
    <div className="flex gap-1 border-b border-gray-800 pb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? "bg-gray-800 text-gray-100"
              : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
