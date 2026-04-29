"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import OpenItemDialog, { OpenItemDialogValue } from "./open-item-dialog";

type Item = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  completedAt: string | null;
};

const PRIORITY_STYLES: Record<Item["priority"], string> = {
  low: "bg-gray-700 text-gray-200",
  medium: "bg-accent/15 text-accent-ink",
  high: "bg-red-900/60 text-red-200",
};

function isOverdue(item: Item): boolean {
  if (!item.dueDate || item.completedAt) return false;
  return new Date(item.dueDate) < new Date(new Date().toISOString().slice(0, 10));
}

export default function OpenItemsList({
  clientId,
  items,
}: {
  clientId: string;
  items: Item[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const open = items.filter((i) => !i.completedAt);
  const done = items.filter((i) => i.completedAt);

  async function create(value: OpenItemDialogValue) {
    await fetch(`/api/clients/${clientId}/open-items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    router.refresh();
  }

  async function update(id: string, patch: Partial<OpenItemDialogValue> & { completedAt?: string | null }) {
    await fetch(`/api/clients/${clientId}/open-items/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/clients/${clientId}/open-items/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-100">
          Open Items ({open.length} open · {done.length} completed)
        </h3>
        <button
          className="rounded bg-accent px-3 py-1.5 text-sm text-accent-on"
          onClick={() => { setEditing(null); setDialogOpen(true); }}
        >
          Add item
        </button>
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-gray-300">No open items.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((i) => (
            <li
              key={i.id}
              className={`flex items-center gap-3 rounded border px-3 py-2 ${
                isOverdue(i)
                  ? "border-red-800 border-l-4 border-l-red-500 bg-red-950/20"
                  : "border-gray-700 bg-gray-900"
              }`}
            >
              <input
                type="checkbox"
                checked={false}
                onChange={() => update(i.id, { completedAt: new Date().toISOString() })}
                aria-label={`Complete ${i.title}`}
              />
              <span className="flex-1 text-gray-100">{i.title}</span>
              <span className={`rounded px-2 py-0.5 text-xs ${PRIORITY_STYLES[i.priority]}`}>
                {i.priority}
              </span>
              {i.dueDate && (
                <span className={`text-xs ${isOverdue(i) ? "text-red-300" : "text-gray-300"}`}>
                  {i.dueDate}
                </span>
              )}
              <button
                className="text-sm text-gray-300 hover:text-gray-200"
                onClick={() => { setEditing(i); setDialogOpen(true); }}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-gray-300">
            Completed ({done.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {done.slice(0, 30).map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded border border-gray-800 bg-gray-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked
                  onChange={() => update(i.id, { completedAt: null })}
                  aria-label={`Reopen ${i.title}`}
                />
                <span className="flex-1 text-gray-300 line-through">{i.title}</span>
                <button
                  className="text-sm text-gray-400 hover:text-gray-200"
                  onClick={() => remove(i.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <OpenItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={
          editing
            ? { title: editing.title, priority: editing.priority, dueDate: editing.dueDate }
            : undefined
        }
        onSubmit={(v) =>
          editing ? update(editing.id, v) : create(v)
        }
        onDelete={editing ? () => remove(editing.id) : undefined}
      />
    </div>
  );
}
