"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog";
import DialogShell from "@/components/dialog-shell";
import {
  buildFolderTree,
  collectFolderSubtreeIds,
  type FolderNode,
} from "@/lib/crm/folder-tree";
import type { VaultFolder } from "./use-vault-data";

type Props = {
  householdId: string;
  folders: VaultFolder[];
  selectedFolderId: string | null;
  onSelect: (id: string | null) => void;
  onMutated: () => void; // reloadFolders
};

type DialogState =
  | { kind: "create"; parentId: string | null }
  | { kind: "rename"; folder: VaultFolder }
  | null;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3 shrink-0 text-ink-4">
      <rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

export default function FolderTreePane({
  householdId,
  folders,
  selectedFolderId,
  onSelect,
  onMutated,
}: Props) {
  const { showToast } = useToast();
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  // Track explicitly-collapsed ids; everything else is open by default so the
  // structure is visible. This survives async folder loads cleanly.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [moveTarget, setMoveTarget] = useState<VaultFolder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultFolder | null>(null);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function mutate(
    url: string,
    init: RequestInit,
    okMsg: string,
  ): Promise<boolean> {
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof j.error === "string" ? j.error : `Request failed (${res.status})`);
      }
      showToast({ message: okMsg });
      onMutated();
      return true;
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Something went wrong" });
      return false;
    }
  }

  const createFolder = (name: string, parentId: string | null) =>
    mutate(
      `/api/crm/households/${householdId}/folders`,
      { method: "POST", body: JSON.stringify({ name, parentFolderId: parentId }) },
      `Created “${name}”`,
    );

  const renameFolder = (id: string, name: string) =>
    mutate(
      `/api/crm/households/${householdId}/folders/${id}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
      "Folder renamed",
    );

  const moveFolder = (id: string, parentId: string | null) =>
    mutate(
      `/api/crm/households/${householdId}/folders/${id}`,
      { method: "PATCH", body: JSON.stringify({ parentFolderId: parentId }) },
      "Folder moved",
    );

  async function deleteFolder(folder: VaultFolder) {
    const ok = await mutate(
      `/api/crm/households/${householdId}/folders/${folder.id}`,
      { method: "DELETE" },
      `Deleted “${folder.name}”`,
    );
    if (ok && selectedFolderId === folder.id) onSelect(null);
  }

  function renderNode(node: FolderNode<VaultFolder>, depth: number) {
    const hasChildren = node.children.length > 0;
    const isOpen = !collapsed.has(node.id);
    const isSelected = selectedFolderId === node.id;
    const indent = 12 + depth * 16;

    return (
      <li key={node.id} className="relative">
        <div
          className={`group flex items-center gap-1 pr-1 text-[13px] ${
            isSelected ? "bg-accent-wash text-ink" : "text-ink-2 hover:bg-card-2/60"
          }`}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggle(node.id)}
            aria-label={hasChildren ? (isOpen ? "Collapse" : "Expand") : undefined}
            aria-expanded={hasChildren ? isOpen : undefined}
            disabled={!hasChildren}
            className="flex h-7 w-4 shrink-0 items-center justify-center disabled:cursor-default"
            style={{ marginLeft: indent }}
          >
            {hasChildren ? <Chevron open={isOpen} /> : <span className="inline-block h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          >
            <FolderIcon width={15} height={15} className="shrink-0 text-ink-3" aria-hidden="true" />
            <span className="truncate">{node.name}</span>
            {node.isSystem && <LockIcon />}
          </button>
          <button
            type="button"
            onClick={() => setMenuId((id) => (id === node.id ? null : node.id))}
            aria-label={`Actions for ${node.name}`}
            aria-haspopup="menu"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-4 opacity-0 transition-opacity hover:bg-card-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 aria-[expanded=true]:opacity-100"
            aria-expanded={menuId === node.id}
          >
            <KebabIcon />
          </button>
        </div>

        {menuId === node.id && (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setMenuId(null)}
            />
            <div
              role="menu"
              className="absolute right-1 top-8 z-20 w-44 overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card py-1 shadow-lg"
            >
              <MenuItem
                onClick={() => {
                  setMenuId(null);
                  setCollapsed((p) => {
                    const n = new Set(p);
                    n.delete(node.id);
                    return n;
                  });
                  setDialog({ kind: "create", parentId: node.id });
                }}
              >
                New subfolder
              </MenuItem>
              {!node.isSystem && (
                <>
                  <MenuItem onClick={() => { setMenuId(null); setDialog({ kind: "rename", folder: node }); }}>
                    Rename
                  </MenuItem>
                  <MenuItem onClick={() => { setMenuId(null); setMoveTarget(node); }}>
                    Move to…
                  </MenuItem>
                  <MenuItem destructive onClick={() => { setMenuId(null); setDeleteTarget(node); }}>
                    Delete
                  </MenuItem>
                </>
              )}
            </div>
          </>
        )}

        {hasChildren && isOpen && (
          <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">Folders</h3>
        <button
          type="button"
          onClick={() => setDialog({ kind: "create", parentId: null })}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium text-accent-ink hover:bg-card-hover"
        >
          + New folder
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
        <li>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`flex w-full items-center gap-2 py-1.5 pl-3 pr-2 text-[13px] ${
              selectedFolderId === null ? "bg-accent-wash text-ink" : "text-ink-2 hover:bg-card-2/60"
            }`}
          >
            <FolderIcon width={15} height={15} className="shrink-0 text-ink-3" aria-hidden="true" />
            <span className="truncate font-medium">Vault root</span>
          </button>
        </li>
        {tree.map((node) => renderNode(node, 0))}
      </ul>

      <FolderNameDialog
        open={dialog !== null}
        title={dialog?.kind === "rename" ? "Rename folder" : "New folder"}
        submitLabel={dialog?.kind === "rename" ? "Rename" : "Create"}
        initialName={dialog?.kind === "rename" ? dialog.folder.name : ""}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          if (!dialog) return;
          const ok =
            dialog.kind === "rename"
              ? await renameFolder(dialog.folder.id, name)
              : await createFolder(name, dialog.parentId);
          if (ok) setDialog(null);
        }}
      />

      <FolderMoveDialog
        folder={moveTarget}
        folders={folders}
        onClose={() => setMoveTarget(null)}
        onSubmit={async (parentId) => {
          if (!moveTarget) return;
          const ok = await moveFolder(moveTarget.id, parentId);
          if (ok) setMoveTarget(null);
        }}
      />

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title="Delete folder"
        message={
          deleteTarget
            ? `Delete “${deleteTarget.name}”? Documents inside will move to the vault root. This cannot be undone.`
            : ""
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await deleteFolder(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-card-hover ${
        destructive ? "text-crit" : "text-ink-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function FolderNameDialog({
  open,
  title,
  submitLabel,
  initialName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialName: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={title}
      size="sm"
      primaryAction={{ label: submitLabel, onClick: submit, loading: saving, disabled: !name.trim() }}
    >
      <label className="block text-[13px] text-ink-2">
        Folder name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          maxLength={120}
          className="mt-1.5 w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
        />
      </label>
    </DialogShell>
  );
}

function FolderMoveDialog({
  folder,
  folders,
  onClose,
  onSubmit,
}: {
  folder: VaultFolder | null;
  folders: VaultFolder[];
  onClose: () => void;
  onSubmit: (parentId: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (folder) setTarget(folder.parentFolderId ?? "");
  }, [folder]);

  // Eligible parents: any folder that isn't the folder itself or one of its
  // descendants (those would create a cycle — the server also rejects them).
  const options = useMemo(() => {
    if (!folder) return [];
    const blocked = new Set(collectFolderSubtreeIds(folders, folder.id));
    const tree = buildFolderTree(folders);
    const flat: { id: string; label: string }[] = [];
    const walk = (nodes: FolderNode<VaultFolder>[], depth: number) => {
      for (const n of nodes) {
        if (!blocked.has(n.id)) {
          flat.push({ id: n.id, label: `${"  ".repeat(depth)}${n.name}` });
        }
        walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);
    return flat;
  }, [folder, folders]);

  if (!folder) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(target === "" ? null : target);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      open={folder !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Move “${folder.name}”`}
      size="sm"
      primaryAction={{ label: "Move", onClick: submit, loading: saving }}
    >
      <label className="block text-[13px] text-ink-2">
        Destination folder
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mt-1.5 w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
        >
          <option value="">Vault root</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>
    </DialogShell>
  );
}
