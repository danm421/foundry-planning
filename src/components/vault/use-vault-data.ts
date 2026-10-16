"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type VaultFolder = {
  id: string;
  name: string;
  parentFolderId: string | null;
  isSystem: boolean;
  sortOrder: number;
};

export type VaultDoc = {
  id: string;
  filename: string;
  description: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  createdAt: string;
  folderId: string | null;
  sourceKind: "upload" | "generated_plan" | "import_ref";
  versionNo: number;
  versionGroupId: string | null;
  isCurrentVersion: boolean;
  importFileId: string | null;
};

/**
 * Vault data loader. App convention: `fetch` + `useState` + `useCallback`,
 * with `reload` invoked after a mutation. Folders (with their document counts)
 * load once per household; documents load for the currently-selected folder
 * (`null` = vault root) and reload on a folder switch — so picking a folder
 * costs one request, not two. The tree reads `folders` directly so it stays
 * visible while `docs` reload.
 *
 * `docs` is null until the selected folder's own listing arrives: documents
 * from the previously-selected folder are never shown under the new one, and a
 * slow response for a folder the user already left is dropped.
 */
export function useVaultData(householdId: string, selectedFolderId: string | null) {
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState<{ folderId: string | null; docs: VaultDoc[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestDocsRequest = useRef(0);

  const reloadFolders = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/households/${householdId}/folders`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load folders (${res.status})`);
      const json = (await res.json()) as { folders: VaultFolder[]; docCounts?: Record<string, number> };
      setFolders(json.folders ?? []);
      setDocCounts(json.docCounts ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [householdId]);

  const reloadDocs = useCallback(async () => {
    const request = ++latestDocsRequest.current;
    setError(null);
    try {
      const q = selectedFolderId === null ? "root" : selectedFolderId;
      const res = await fetch(`/api/crm/households/${householdId}/documents?folderId=${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      const json = (await res.json()) as { documents: VaultDoc[] };
      if (request === latestDocsRequest.current) {
        setLoaded({ folderId: selectedFolderId, docs: json.documents ?? [] });
      }
    } catch (e) {
      if (request === latestDocsRequest.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [householdId, selectedFolderId]);

  // Folders load once per household; documents (re)load when the selection changes.
  useEffect(() => {
    void reloadFolders();
  }, [reloadFolders]);
  useEffect(() => {
    void reloadDocs();
  }, [reloadDocs]);

  // Any write can change a folder's count, so a refresh reloads both.
  const reload = useCallback(() => {
    void reloadFolders();
    void reloadDocs();
  }, [reloadFolders, reloadDocs]);

  const docs = loaded?.folderId === selectedFolderId ? loaded.docs : null;
  return { folders, docCounts, docs, error, reload };
}
