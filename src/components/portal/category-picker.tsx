"use client";
import type { ReactElement } from "react";

type CategoryRow = { id: string; name: string; kind: "group" | "category"; parentId: string | null };

export function CategoryPicker({
  categories,
  value,
  onPick,
}: {
  categories: CategoryRow[];
  value: string | null;
  onPick: (categoryId: string | null) => void;
}): ReactElement {
  const groups = categories.filter((c) => c.kind === "group");
  const leavesByParent = (gid: string) => categories.filter((c) => c.kind === "category" && c.parentId === gid);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onPick(e.target.value === "" ? null : e.target.value)}
      className="rounded-md border border-hair bg-card-2 px-2 py-1 text-[12px] text-ink-2"
    >
      <option value="">Uncategorized</option>
      {groups.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {leavesByParent(g.id).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
