// src/components/portal/add-category-form.tsx
"use client";
import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { usePortalFetch } from "@/components/portal/portal-mode-context";

const NEW_GROUP = "__new__";
// Palette for a brand-new group (grey is the route's fallback default).
const GROUP_COLORS = [
  "var(--data-blue)",
  "var(--data-green)",
  "var(--data-orange)",
  "var(--data-purple)",
  "var(--data-pink)",
  "var(--data-red)",
  "var(--data-teal)",
  "var(--data-yellow)",
];

/**
 * Inline "Add category" form for the portal Budget list. Adds a category into an
 * existing group (one POST) or creates a new group first (two sequential POSTs).
 * The new leaf inherits its group's color; a new group gets the next palette
 * token. All fetches are act-as aware via usePortalFetch.
 */
export function AddCategoryForm({
  groups,
}: {
  groups: { id: string; name: string; color: string }[];
}): ReactElement {
  const router = useRouter();
  const portalFetch = usePortalFetch();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState<string>(groups[0]?.id ?? NEW_GROUP);
  const [newGroupName, setNewGroupName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setName("");
    setNewGroupName("");
    setGroupId(groups[0]?.id ?? NEW_GROUP);
    setError(null);
    setOpen(false);
  }

  async function post(body: object): Promise<{ ok: boolean; id?: string }> {
    const res = await portalFetch("/api/portal/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { id: string };
    return { ok: true, id: json.id };
  }

  async function submit(): Promise<void> {
    const catName = name.trim();
    if (!catName) {
      setError("Enter a category name.");
      return;
    }
    const creatingGroup = groupId === NEW_GROUP;
    if (creatingGroup && !newGroupName.trim()) {
      setError("Enter a group name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let parentId = groupId;
      let leafColor: string;
      if (creatingGroup) {
        const color = GROUP_COLORS[groups.length % GROUP_COLORS.length];
        const g = await post({ name: newGroupName.trim(), kind: "group", color });
        if (!g.ok || !g.id) {
          setError("Couldn't create the group.");
          return;
        }
        parentId = g.id;
        leafColor = color;
      } else {
        // The select only offers existing groups + "New group…", so a
        // non-creating submit always resolves to a real group color.
        leafColor = groups.find((g) => g.id === groupId)!.color;
      }
      const leaf = await post({
        name: catName,
        kind: "category",
        parentId,
        color: leafColor,
      });
      if (!leaf.ok) {
        setError("Couldn't create the category.");
        return;
      }
      reset();
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[12px] text-ink-3 hover:bg-card-2 hover:text-ink-2"
      >
        <span aria-hidden className="text-[14px] leading-none">
          +
        </span>{" "}
        Add category
      </button>
    );
  }

  const fieldCls =
    "w-full rounded-md border border-hair bg-card px-2 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="mt-1 space-y-2 rounded-lg border border-hair bg-card-2/40 p-3">
      <input
        autoFocus
        aria-label="Category name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        placeholder="Category name"
        className={fieldCls}
      />
      <select
        aria-label="Group"
        value={groupId}
        onChange={(e) => {
          setGroupId(e.target.value);
          setError(null);
        }}
        className={fieldCls}
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        <option value={NEW_GROUP}>New group…</option>
      </select>
      {groupId === NEW_GROUP && (
        <input
          aria-label="New group name"
          value={newGroupName}
          onChange={(e) => {
            setNewGroupName(e.target.value);
            setError(null);
          }}
          placeholder="New group name"
          className={fieldCls}
        />
      )}
      {error && <p className="text-[12px] text-crit">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="rounded-md bg-accent/20 px-3 py-1 text-[12px] font-medium text-accent disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-card-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
