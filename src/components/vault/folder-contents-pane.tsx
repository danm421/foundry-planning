"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  DownloadIcon,
  FileTextIcon,
  SearchIcon,
} from "@/components/icons";
import { useToast } from "@/components/toast";
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog";
import DialogShell from "@/components/dialog-shell";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/crm/document-constants";
import type { VaultDoc, VaultFolder } from "./use-vault-data";
import { useVaultMutate } from "./use-vault-mutate";
import { humanSize, formatTimestamp } from "./format";

type Props = {
  householdId: string;
  selectedFolderId: string | null;
  folders: VaultFolder[]; // for the move-picker
  docs: VaultDoc[];
  onMutated: () => void; // reloadDocs
  onOpenHistory: (docId: string) => void;
};

const MAX_MB = Math.floor(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024));

export default function FolderContentsPane({
  householdId,
  selectedFolderId,
  folders,
  docs,
  onMutated,
  onOpenHistory,
}: Props) {
  const { showToast } = useToast();
  const mutate = useVaultMutate(onMutated);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<VaultDoc | null>(null);
  const [moveTarget, setMoveTarget] = useState<VaultDoc | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultDoc | null>(null);
  const [staleIds, setStaleIds] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => d.filename.toLowerCase().includes(q));
  }, [docs, search]);

  async function uploadFiles(files: File[]) {
    const tooBig = files.find((f) => f.size > MAX_DOCUMENT_SIZE_BYTES);
    if (tooBig) {
      showToast({ message: `${tooBig.name} is too large. Maximum size is ${MAX_MB}MB.` });
      return;
    }
    setUploading(true);
    let failed = 0;
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (selectedFolderId) fd.append("folderId", selectedFolderId);
        const res = await fetch(`/api/crm/households/${householdId}/documents`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: unknown };
          throw new Error(typeof j.error === "string" ? j.error : `Upload failed (${res.status})`);
        }
      } catch (err) {
        failed++;
        showToast({ message: err instanceof Error ? err.message : `Failed to upload ${file.name}` });
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    const ok = files.length - failed;
    if (ok > 0) {
      showToast({ message: ok === 1 ? "Document uploaded" : `${ok} documents uploaded` });
      onMutated();
    }
  }

  async function download(doc: VaultDoc) {
    try {
      const res = await fetch(`/api/crm/households/${householdId}/documents/${doc.id}`, { cache: "no-store" });
      if (res.status === 410) {
        setStaleIds((prev) => new Set(prev).add(doc.id));
        showToast({ message: "This linked document is no longer available" });
        return;
      }
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Download failed" });
    }
  }

  const renameDoc = (id: string, filename: string) =>
    mutate(
      `/api/crm/households/${householdId}/documents/${id}`,
      { method: "PATCH", body: JSON.stringify({ filename }) },
      "Document renamed",
    );

  const moveDoc = (id: string, folderId: string | null) =>
    mutate(
      `/api/crm/households/${householdId}/documents/${id}`,
      { method: "PATCH", body: JSON.stringify({ folderId }) },
      "Document moved",
    );

  const deleteDoc = (doc: VaultDoc) =>
    mutate(
      `/api/crm/households/${householdId}/documents/${doc.id}`,
      { method: "DELETE" },
      `Deleted “${doc.filename}”`,
    );

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) void uploadFiles(files);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Drop zone + search */}
      <div className="flex flex-col gap-3 border-b border-hair px-5 py-4">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); }
          }}
          className={
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius)] border border-dashed px-4 py-5 text-center text-[13px] transition-colors " +
            (dragOver
              ? "border-accent bg-accent-wash text-accent-ink"
              : "border-hair bg-card-2 text-ink-3 hover:border-hair-2 hover:text-ink-2")
          }
        >
          <span className="font-medium">
            {uploading ? "Uploading…" : "Drop files here or click to upload"}
          </span>
          <span className="text-[11px] text-ink-3">
            Up to {MAX_MB}MB each · stored privately for your firm
          </span>
          <input ref={inputRef} type="file" multiple className="sr-only" onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void uploadFiles(files);
          }} />
        </div>

        <div className="relative">
          <SearchIcon
            width={15}
            height={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this folder…"
            className="w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-accent"
          />
        </div>
      </div>

      {/* File list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {filtered.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-10 text-center">
            <p className="text-[13px] text-ink-3">
              {docs.length === 0 ? "No documents in this folder yet." : "No documents match your search."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((doc) => {
              const stale = staleIds.has(doc.id);
              return (
                <li
                  key={doc.id}
                  className="relative flex items-start gap-3 rounded-[var(--radius)] border border-hair bg-card p-3.5 transition-colors hover:border-hair-2"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
                    <FileTextIcon width={14} height={14} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="truncate text-[13.5px] font-semibold text-ink">{doc.filename}</p>
                      <span className="tabular text-[11.5px] text-ink-3">{humanSize(doc.sizeBytes)}</span>
                      <SourceBadge doc={doc} />
                      {stale && (
                        <span className="inline-flex items-center gap-1 rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn">
                          <AlertCircleIcon width={11} height={11} aria-hidden="true" /> Stale link
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
                      <time dateTime={doc.createdAt} title={new Date(doc.createdAt).toLocaleString()} className="tabular">
                        {formatTimestamp(doc.createdAt)}
                      </time>
                      {doc.description && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{doc.description}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => download(doc)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-accent/10 hover:text-accent"
                      aria-label={`Download ${doc.filename}`}
                      title="Download"
                    >
                      <DownloadIcon width={14} height={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenuDocId((id) => (id === doc.id ? null : doc.id))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-4 transition-colors hover:bg-card-hover hover:text-ink aria-[expanded=true]:text-ink"
                      aria-label={`Actions for ${doc.filename}`}
                      aria-haspopup="menu"
                      aria-expanded={menuDocId === doc.id}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
                        <circle cx="12" cy="5" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="12" cy="19" r="1.6" />
                      </svg>
                    </button>
                  </div>

                  {menuDocId === doc.id && (
                    <>
                      <button
                        type="button"
                        aria-hidden="true"
                        tabIndex={-1}
                        className="fixed inset-0 z-10 cursor-default"
                        onClick={() => setMenuDocId(null)}
                      />
                      <div
                        role="menu"
                        className="absolute right-3 top-12 z-20 w-48 overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card py-1 shadow-lg"
                      >
                        {doc.versionGroupId && (
                          <RowMenuItem onClick={() => { setMenuDocId(null); onOpenHistory(doc.id); }}>
                            Version history
                          </RowMenuItem>
                        )}
                        <RowMenuItem onClick={() => { setMenuDocId(null); setRenameTarget(doc); }}>
                          Rename
                        </RowMenuItem>
                        <RowMenuItem onClick={() => { setMenuDocId(null); setMoveTarget(doc); }}>
                          Move to…
                        </RowMenuItem>
                        <RowMenuItem
                          destructive
                          title={doc.sourceKind === "import_ref" ? "Removes the link only; the original import file is kept" : undefined}
                          onClick={() => { setMenuDocId(null); setDeleteTarget(doc); }}
                        >
                          {doc.sourceKind === "import_ref" ? "Remove link" : "Delete"}
                        </RowMenuItem>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <RenameDocDialog
        doc={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (filename) => {
          if (!renameTarget) return;
          const ok = await renameDoc(renameTarget.id, filename);
          if (ok) setRenameTarget(null);
        }}
      />

      <MoveDocDialog
        doc={moveTarget}
        folders={folders}
        onClose={() => setMoveTarget(null)}
        onSubmit={async (folderId) => {
          if (!moveTarget) return;
          const ok = await moveDoc(moveTarget.id, folderId);
          if (ok) setMoveTarget(null);
        }}
      />

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title={deleteTarget?.sourceKind === "import_ref" ? "Remove document link" : "Delete document"}
        message={
          deleteTarget
            ? deleteTarget.sourceKind === "import_ref"
              ? `Remove the link to “${deleteTarget.filename}”? This removes the link only; the original import file is kept.`
              : `Delete “${deleteTarget.filename}”? This cannot be undone.`
            : ""
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await deleteDoc(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function SourceBadge({ doc }: { doc: VaultDoc }) {
  const base = "rounded border border-hair bg-card-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3";
  if (doc.sourceKind === "generated_plan") {
    return (
      <span className={base}>
        Plan <span className="tabular">v{doc.versionNo}</span>
      </span>
    );
  }
  if (doc.sourceKind === "import_ref") {
    return <span className={base}>Imported</span>;
  }
  return <span className={base}>Uploaded</span>;
}

function RowMenuItem({
  children,
  onClick,
  destructive,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-card-hover ${
        destructive ? "text-crit" : "text-ink-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function RenameDocDialog({
  doc,
  onClose,
  onSubmit,
}: {
  doc: VaultDoc | null;
  onClose: () => void;
  onSubmit: (filename: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (doc) setName(doc.filename); }, [doc]);

  if (!doc) return null;

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
      open={doc !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Rename document"
      size="sm"
      primaryAction={{ label: "Rename", onClick: submit, loading: saving, disabled: !name.trim() }}
    >
      <label className="block text-[13px] text-ink-2">
        File name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          maxLength={255}
          className="mt-1.5 w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
        />
      </label>
    </DialogShell>
  );
}

function MoveDocDialog({
  doc,
  folders,
  onClose,
  onSubmit,
}: {
  doc: VaultDoc | null;
  folders: VaultFolder[];
  onClose: () => void;
  onSubmit: (folderId: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (doc) setTarget(doc.folderId ?? ""); }, [doc]);

  const sorted = useMemo(
    () => [...folders].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [folders],
  );

  if (!doc) return null;

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
      open={doc !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Move “${doc.filename}”`}
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
          {sorted.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
    </DialogShell>
  );
}
