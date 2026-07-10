"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import DialogShell from "@/components/dialog-shell";
import { FolderIcon } from "./vault-icons";
import type { FolderOption } from "./vault-format";

/**
 * Destination picker for moving a document. Lists the whole folder tree
 * (indented by depth) rooted at "My Documents"; the file's current folder is
 * shown but not selectable. Built on DialogShell.
 */
export function VaultMoveDialog({
  filename,
  options,
  currentFolderId,
  onCancel,
  onMove,
}: {
  filename: string;
  options: FolderOption[];
  currentFolderId: string;
  onCancel: () => void;
  onMove: (destFolderId: string) => Promise<void>;
}): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onMove(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => { if (!o) onCancel(); }}
      title="Move to folder"
      size="sm"
      primaryAction={{ label: "Move here", onClick: () => void submit(), disabled: !selected || saving, loading: saving }}
    >
      <p className="mb-3 truncate text-[13px] text-ink-3">
        Moving <span className="font-medium text-ink">{filename}</span>
      </p>
      <ul className="max-h-[46vh] overflow-y-auto rounded-lg border border-hair" role="listbox" aria-label="Destination folder">
        {options.map((opt) => {
          const isCurrent = opt.id === currentFolderId;
          const isSelected = opt.id === selected;
          return (
            <li key={opt.id}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isCurrent}
                onClick={() => setSelected(opt.id)}
                style={{ paddingLeft: `${12 + opt.depth * 16}px` }}
                className={`flex w-full items-center gap-2 py-2 pr-3 text-left text-[13px] transition ${
                  isSelected
                    ? "bg-accent/15 text-ink"
                    : isCurrent
                      ? "cursor-not-allowed text-ink-4"
                      : "text-ink-2 hover:bg-card-2"
                }`}
              >
                <FolderIcon width={15} height={15} className="shrink-0 text-ink-3" />
                <span className="flex-1 truncate">{opt.name}</span>
                {isCurrent && <span className="shrink-0 text-[11px] text-ink-4">Current</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-2 text-[12px] text-crit">{error}</p>}
    </DialogShell>
  );
}
