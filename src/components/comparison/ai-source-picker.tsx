"use client";

import { useState } from "react";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";

interface SourceSelection {
  groupIds: string[];
  cellIds: string[];
}

interface Props {
  layout: ComparisonLayoutV5;
  selfCellId: string;
  value: SourceSelection;
  onChange: (next: SourceSelection) => void;
}

export function AiSourcePicker({ layout, selfCellId, value, onChange }: Props) {
  const [showWidgets, setShowWidgets] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupId: string) => {
    const checked = value.groupIds.includes(groupId);
    onChange({
      ...value,
      groupIds: checked
        ? value.groupIds.filter((g) => g !== groupId)
        : [...value.groupIds, groupId],
    });
  };

  const toggleCell = (cellId: string) => {
    const checked = value.cellIds.includes(cellId);
    onChange({
      ...value,
      cellIds: checked
        ? value.cellIds.filter((c) => c !== cellId)
        : [...value.cellIds, cellId],
    });
  };

  if (layout.groups.length === 0) {
    return <p className="text-xs text-slate-400">No groups in this layout yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {layout.groups.map((g) => {
        const populated = g.cells.filter((c) => c.widget && c.id !== selfCellId);
        if (populated.length === 0) return null;
        const drill = showWidgets[g.id] ?? false;
        return (
          <div key={g.id} className="rounded border border-slate-800 p-2">
            <label className="flex items-center gap-2 text-sm text-slate-100">
              <input
                type="checkbox"
                checked={value.groupIds.includes(g.id)}
                onChange={() => toggleGroup(g.id)}
              />
              <span className="flex-1 truncate font-medium">{g.title || "Untitled group"}</span>
              <span className="text-[11px] text-slate-400">{populated.length} widget{populated.length === 1 ? "" : "s"}</span>
            </label>
            <button
              type="button"
              className="mt-1 text-[11px] text-amber-300 hover:underline"
              onClick={() => setShowWidgets((s) => ({ ...s, [g.id]: !drill }))}
            >
              {drill ? "Hide widgets" : "Show widgets"}
            </button>
            {drill && (
              <ul className="mt-1 flex flex-col gap-1 border-l border-slate-800 pl-3">
                {populated.map((c) => {
                  const def = COMPARISON_WIDGETS[c.widget!.kind];
                  return (
                    <li key={c.id}>
                      <label className="flex items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={value.cellIds.includes(c.id)}
                          onChange={() => toggleCell(c.id)}
                        />
                        <span>{def?.title ?? c.widget!.kind}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
