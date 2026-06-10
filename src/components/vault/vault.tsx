"use client";

import { useMemo, useState } from "react";
import { AlertCircleIcon, DownloadIcon } from "@/components/icons";
import { useVaultData, type VaultFolder } from "./use-vault-data";
import FolderTreePane from "./folder-tree-pane";
import FolderContentsPane from "./folder-contents-pane";
import VersionHistoryDialog from "./version-history-dialog";

type Props = { householdId: string };

export default function Vault({ householdId }: Props) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);

  const { folders, docs, loading, error, reloadFolders, reloadDocs } = useVaultData(
    householdId,
    selectedFolderId,
  );

  // Breadcrumb path: walk the selected folder up its parent chain to the root.
  const path = useMemo<VaultFolder[]>(() => {
    if (selectedFolderId === null) return [];
    const byId = new Map(folders.map((f) => [f.id, f]));
    const chain: VaultFolder[] = [];
    let cur = byId.get(selectedFolderId);
    let guard = 0;
    while (cur && guard++ < 1000) {
      chain.unshift(cur);
      cur = cur.parentFolderId ? byId.get(cur.parentFolderId) : undefined;
    }
    return chain;
  }, [folders, selectedFolderId]);

  const zipHref = `/api/crm/households/${householdId}/documents/zip?folderId=${selectedFolderId ?? "root"}`;
  const zipLabel = selectedFolderId === null ? "Download vault (.zip)" : "Download folder (.zip)";

  return (
    <div className="flex h-[calc(100vh-280px)] min-h-[480px] max-h-[780px] flex-col overflow-hidden rounded-[var(--radius)] border border-hair bg-paper">
      {/* Top bar: breadcrumb + zip download */}
      <div className="flex items-center justify-between gap-3 border-b border-hair px-5 py-3">
        <nav aria-label="Folder path" className="flex min-w-0 items-center gap-1 text-[13px]">
          <button
            type="button"
            onClick={() => setSelectedFolderId(null)}
            className={`shrink-0 ${selectedFolderId === null ? "font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            Vault root
          </button>
          {path.map((f, i) => (
            <span key={f.id} className="flex min-w-0 items-center gap-1">
              <span aria-hidden className="text-ink-4">/</span>
              <button
                type="button"
                onClick={() => setSelectedFolderId(f.id)}
                className={`truncate ${i === path.length - 1 ? "font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>
        <a
          href={zipHref}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
        >
          <DownloadIcon width={14} height={14} aria-hidden="true" />
          {zipLabel}
        </a>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-crit/30 bg-crit/10 px-5 py-2 text-[13px] text-crit"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Two panes */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] shrink-0 overflow-hidden border-r border-hair">
          <FolderTreePane
            householdId={householdId}
            folders={folders}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onMutated={reloadFolders}
          />
        </aside>
        <main className="min-w-0 flex-1">
          {loading && docs.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-ink-3">Loading…</p>
          ) : (
            <FolderContentsPane
              householdId={householdId}
              selectedFolderId={selectedFolderId}
              folders={folders}
              docs={docs}
              onMutated={reloadDocs}
              onOpenHistory={setHistoryDocId}
            />
          )}
        </main>
      </div>

      <VersionHistoryDialog
        householdId={householdId}
        docId={historyDocId}
        onClose={() => setHistoryDocId(null)}
      />
    </div>
  );
}
