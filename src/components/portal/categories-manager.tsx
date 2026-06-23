"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";

type CategoryRow = {
  id: string; name: string; kind: "group" | "category"; parentId: string | null;
  color: string; isSystem: boolean; sortOrder: number;
};

const COLOR_TOKENS = [
  "var(--data-red)", "var(--data-blue)", "var(--data-green)", "var(--data-yellow)",
  "var(--data-grey)", "var(--data-orange)", "var(--data-purple)", "var(--data-teal)", "var(--data-pink)",
];

export default function CategoriesManager({ editEnabled }: { editEnabled: boolean }): ReactElement {
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    return fetch("/api/portal/categories")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { categories: CategoryRow[] } | null) => { if (d) setCats(d.categories ?? []); })
      .catch(() => {});
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const mutate = useCallback(async (fn: () => Promise<Response>) => {
    setError(null);
    const res = await fn();
    if (!res.ok) { setError("Couldn't save that change."); return; }
    reload();
  }, [reload]);

  const groups = cats.filter((c) => c.kind === "group");
  const leavesOf = (gid: string) => cats.filter((c) => c.kind === "category" && c.parentId === gid);
  const allLeaves = cats.filter((c) => c.kind === "category");

  return (
    <div className="space-y-4">
      {error && <p className="text-[12px] text-crit">{error}</p>}
      {groups.map((g) => (
        <div key={g.id} className="rounded-xl border border-hair bg-card p-4">
          <div className="mb-2 text-[13px] font-medium text-ink">{g.name}</div>
          <ul className="space-y-1.5">
            {leavesOf(g.id).map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                <span className="flex-1 text-[13px] text-ink-2">{l.name}</span>
                {editEnabled && (
                  <>
                    <select
                      value={l.color}
                      onChange={(e) => void mutate(() => fetch(`/api/portal/categories/${l.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ color: e.target.value }) }))}
                      className="rounded-md border border-hair bg-card-2 px-1 py-0.5 text-[11px] text-ink-3"
                    >
                      {COLOR_TOKENS.map((c) => <option key={c} value={c}>{c.replace("var(--data-", "").replace(")", "")}</option>)}
                    </select>
                    {!l.isSystem && (
                      <DeleteLeaf leaf={l} otherLeaves={allLeaves.filter((x) => x.id !== l.id)} onDelete={(reassignToId) =>
                        mutate(() => fetch(`/api/portal/categories/${l.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ reassignToId }) }))} />
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {editEnabled && (
            <AddLeaf groupId={g.id} onAdd={(name) =>
              mutate(() => fetch("/api/portal/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, kind: "category", parentId: g.id }) }))} />
          )}
        </div>
      ))}
    </div>
  );
}

// groupId is part of the call contract; the parent bakes it into the onAdd closure
function AddLeaf({ onAdd }: { groupId: string; onAdd: (name: string) => Promise<void> }): ReactElement {
  const [name, setName] = useState("");
  return (
    <div className="mt-2 flex items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add category…"
        className="flex-1 rounded-md border border-hair bg-card-2 px-2 py-1 text-[12px] text-ink" />
      <button type="button" disabled={!name.trim()} onClick={() => { void onAdd(name.trim()); setName(""); }}
        className="rounded-md border border-hair px-2 py-1 text-[12px] text-ink-2 hover:bg-card-2 disabled:opacity-50">Add</button>
    </div>
  );
}

// leaf is part of the call contract; the parent bakes leaf.id into the onDelete closure
function DeleteLeaf({ otherLeaves, onDelete }: {
  leaf: CategoryRow; otherLeaves: CategoryRow[]; onDelete: (reassignToId: string | null) => Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [reassignToId, setReassignToId] = useState<string>("");
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-hair px-2 py-0.5 text-[11px] text-ink-3 hover:bg-card-2">Delete</button>;
  }
  return (
    <span className="flex items-center gap-1">
      <select value={reassignToId} onChange={(e) => setReassignToId(e.target.value)}
        className="rounded-md border border-hair bg-card-2 px-1 py-0.5 text-[11px] text-ink-3">
        <option value="">Uncategorize</option>
        {otherLeaves.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button type="button" onClick={() => { void onDelete(reassignToId || null); setOpen(false); }}
        className="rounded-md border border-hair px-2 py-0.5 text-[11px] text-crit hover:bg-card-2">Confirm</button>
    </span>
  );
}
