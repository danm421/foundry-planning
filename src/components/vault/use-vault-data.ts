"use client";
import { useCallback, useEffect, useState } from "react";

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
 * with `reload*` callbacks invoked after a mutation. Folders load once per
 * household; documents load for the currently-selected folder (`null` = vault
 * root) and reload on a folder switch — so picking a folder costs one request,
 * not two. The tree reads `folders` directly so it stays visible while `docs`
 * reload — keep the tree out from behind `loading` in the container.
 */
export function useVaultData(householdId: string, selectedFolderId: string | null) {
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadFolders = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/households/${householdId}/folders`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load folders (${res.status})`);
      const json = (await res.json()) as { folders: VaultFolder[] };
      setFolders(json.folders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [householdId]);

  const reloadDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = selectedFolderId === null ? "root" : selectedFolderId;
      const res = await fetch(`/api/crm/households/${householdId}/documents?folderId=${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      const json = (await res.json()) as { documents: VaultDoc[] };
      setDocs(json.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [householdId, selectedFolderId]);

  // Folders load once per household; documents (re)load when the selection changes.
  useEffect(() => {
    void reloadFolders();
  }, [reloadFolders]);
  useEffect(() => {
    void reloadDocs();
  }, [reloadDocs]);

  return { folders, docs, loading, error, reloadFolders, reloadDocs };
}
