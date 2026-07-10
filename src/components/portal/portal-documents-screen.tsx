"use client";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/crm/document-constants";
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog";
import { portalBtn } from "@/components/portal/portal-card";
import { usePortalVault, type VaultDoc } from "./documents/use-portal-vault";
import {
  filenameFromContentDisposition,
  flattenFolderTree,
  folderAncestors,
  formatBytes,
} from "./documents/vault-format";
import { VaultBreadcrumb } from "./documents/vault-breadcrumb";
import { VaultFolderRow } from "./documents/vault-folder-row";
import { VaultFileRow } from "./documents/vault-file-row";
import { VaultUploadButton } from "./documents/vault-upload-button";
import { VaultNameDialog } from "./documents/vault-name-dialog";
import { VaultMoveDialog } from "./documents/vault-move-dialog";
import { FolderPlusIcon, FileGlyph } from "./documents/vault-icons";

type RenameTarget = { kind: "doc" | "folder"; id: string; name: string };
type DeleteTarget = { kind: "doc" | "folder"; id: string; name: string };

/** Pull the server's `{ error }` message off a non-OK response, else a fallback. */
async function messageFor(res: Response, fallback: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: unknown };
    if (j && typeof j.error === "string" && j.error.trim()) return j.error;
  } catch {
    /* non-JSON body — use the fallback */
  }
  return fallback;
}

export function PortalDocumentsScreen({ editEnabled }: { editEnabled: boolean }): ReactElement {
  const v = usePortalVault();
  const [uploading, setUploading] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<VaultDoc | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const trail = useMemo(
    () => folderAncestors(v.folders, v.currentFolderId, v.rootId),
    [v.folders, v.currentFolderId, v.rootId],
  );
  const parentKey = v.currentFolderId ?? v.rootId;
  const childFolders = useMemo(
    () =>
      v.folders
        .filter((f) => !f.isRoot && f.parentFolderId === parentKey)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [v.folders, parentKey],
  );
  const moveOptions = useMemo(() => flattenFolderTree(v.folders, v.rootId), [v.folders, v.rootId]);

  const isEmpty =
    !v.loading && v.rootId !== null && childFolders.length === 0 && v.docs.length === 0;
  const atRoot = v.currentFolderId === null;

  async function handleUpload(file: File): Promise<void> {
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      v.setError(`"${file.name}" is ${formatBytes(file.size)} — the limit is 10 MB.`);
      return;
    }
    setUploading(file.name);
    v.setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (v.currentFolderId) fd.append("folderId", v.currentFolderId);
      const res = await v.portalFetch("/api/portal/documents", { method: "POST", body: fd });
      if (!res.ok) {
        v.setError(await messageFor(res, "Upload failed. Please try again."));
        return;
      }
      await v.reloadDocs();
    } catch {
      v.setError("Upload failed. Please try again.");
    } finally {
      setUploading(null);
    }
  }

  // Fetch through usePortalFetch (so the x-portal-as-client header rides along in
  // advisor preview — a plain <a href> would 403), read the blob, and save it
  // client-side. The URL stays on the /api proxy, never a blob-store URL.
  async function handleDownload(doc: VaultDoc): Promise<void> {
    setDownloadingId(doc.id);
    v.setError(null);
    try {
      const res = await v.portalFetch(`/api/portal/documents/${doc.id}`);
      if (!res.ok) {
        v.setError("Couldn't download that file. Please try again.");
        return;
      }
      const blob = await res.blob();
      const served = filenameFromContentDisposition(res.headers.get("Content-Disposition"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = served ?? doc.filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so the download has been handed off before the URL dies.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      v.setError("Couldn't download that file. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleNewFolder(name: string): Promise<void> {
    const res = await v.portalFetch("/api/portal/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentFolderId: v.currentFolderId }),
    });
    if (!res.ok) throw new Error(await messageFor(res, "Couldn't create that folder."));
    setNewFolderOpen(false);
    await v.reload();
  }

  async function handleRename(name: string): Promise<void> {
    if (!renameTarget) return;
    const url =
      renameTarget.kind === "doc"
        ? `/api/portal/documents/${renameTarget.id}`
        : `/api/portal/folders/${renameTarget.id}`;
    const body = renameTarget.kind === "doc" ? { filename: name } : { name };
    const res = await v.portalFetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await messageFor(res, "Couldn't rename that."));
    setRenameTarget(null);
    await v.reload();
  }

  async function handleMove(destFolderId: string): Promise<void> {
    if (!moveTarget) return;
    const res = await v.portalFetch(`/api/portal/documents/${moveTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: destFolderId }),
    });
    if (!res.ok) throw new Error(await messageFor(res, "Couldn't move that file."));
    setMoveTarget(null);
    await v.reloadDocs();
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return;
    const url =
      deleteTarget.kind === "doc"
        ? `/api/portal/documents/${deleteTarget.id}`
        : `/api/portal/folders/${deleteTarget.id}`;
    try {
      const res = await v.portalFetch(url, { method: "DELETE" });
      if (!res.ok) v.setError(await messageFor(res, "Couldn't delete that."));
      else await v.reload();
    } catch {
      v.setError("Couldn't delete that.");
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold text-ink">Documents</h1>
        <p className="text-[13px] text-ink-3">
          Files shared securely between you and your advisor.
        </p>
      </header>

      <div className="flex items-center justify-between gap-3">
        <VaultBreadcrumb trail={trail} onNavigate={v.setCurrentFolderId} />
        {editEnabled && (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setNewFolderOpen(true)} className={portalBtn.ghost}>
              <FolderPlusIcon width={15} height={15} />
              <span className="hidden sm:inline">New folder</span>
            </button>
            <VaultUploadButton busy={uploading !== null} onFile={(f) => void handleUpload(f)} />
          </div>
        )}
      </div>

      {uploading !== null && (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <p className="truncate text-[12px] text-ink-3">Uploading {uploading}…</p>
          <div className="h-1 w-full animate-pulse rounded-full bg-accent/40" />
        </div>
      )}

      {v.error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <span className="min-w-0">{v.error}</span>
          <button
            type="button"
            onClick={() => v.setError(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded px-1 leading-none text-crit/70 hover:text-crit"
          >
            ✕
          </button>
        </div>
      )}

      {isEmpty ? (
        <EmptyState editEnabled={editEnabled} atRoot={atRoot} />
      ) : (
        <div className="divide-y divide-hair overflow-hidden rounded-xl border border-hair bg-card">
          {v.loading && v.docs.length === 0 && childFolders.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-ink-3">Loading…</p>
          ) : (
            <>
              {childFolders.map((f) => (
                <VaultFolderRow
                  key={f.id}
                  folder={f}
                  editEnabled={editEnabled}
                  onOpen={() => v.setCurrentFolderId(f.id)}
                  onRename={() => setRenameTarget({ kind: "folder", id: f.id, name: f.name })}
                  onDelete={() => setDeleteTarget({ kind: "folder", id: f.id, name: f.name })}
                />
              ))}
              {v.docs.map((d) => (
                <VaultFileRow
                  key={d.id}
                  doc={d}
                  editEnabled={editEnabled}
                  downloading={downloadingId === d.id}
                  onDownload={() => void handleDownload(d)}
                  onRename={() => setRenameTarget({ kind: "doc", id: d.id, name: d.filename })}
                  onMove={() => setMoveTarget(d)}
                  onDelete={() => setDeleteTarget({ kind: "doc", id: d.id, name: d.filename })}
                />
              ))}
            </>
          )}
        </div>
      )}

      {newFolderOpen && (
        <VaultNameDialog
          title="New folder"
          label="Folder name"
          confirmLabel="Create folder"
          maxLength={120}
          onCancel={() => setNewFolderOpen(false)}
          onSubmit={handleNewFolder}
        />
      )}
      {renameTarget && (
        <VaultNameDialog
          title={renameTarget.kind === "folder" ? "Rename folder" : "Rename file"}
          label={renameTarget.kind === "folder" ? "Folder name" : "File name"}
          initialValue={renameTarget.name}
          confirmLabel="Save"
          maxLength={renameTarget.kind === "folder" ? 120 : 255}
          onCancel={() => setRenameTarget(null)}
          onSubmit={handleRename}
        />
      )}
      {moveTarget && v.rootId && (
        <VaultMoveDialog
          filename={moveTarget.filename}
          options={moveOptions}
          currentFolderId={moveTarget.folderId ?? v.rootId}
          onCancel={() => setMoveTarget(null)}
          onMove={handleMove}
        />
      )}
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === "folder" ? "Delete folder" : "Delete file"}
        message={
          deleteTarget?.kind === "folder"
            ? `Delete "${deleteTarget?.name}"? The folder must be empty first.`
            : `Delete "${deleteTarget?.name}"? This can't be undone.`
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}

function EmptyState({ editEnabled, atRoot }: { editEnabled: boolean; atRoot: boolean }): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-hair bg-card px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card-2 text-ink-3">
        <FileGlyph kind="file" width={22} height={22} />
      </span>
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-ink">
          {atRoot ? "No documents yet" : "This folder is empty"}
        </p>
        <p className="text-[13px] text-ink-3">
          {editEnabled
            ? "Upload your first document — statements, IDs, or anything your advisor asked for."
            : "Documents your advisor shares will appear here."}
        </p>
      </div>
    </div>
  );
}
