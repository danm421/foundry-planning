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
 * with `reload*` callbacks invoked after a mutation. Folders load for the
 * whole household; documents load for the currently-selected folder
 * (`null` = vault root). The tree reads `folders` directly so it stays
 * visible while `docs` reload on a folder switch — keep the tree out from
 * behind `loading` in the container.
 */
export function useVaultData(householdId: string, selectedFolderId: string | null) {
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadFolders = useCallback(async () => {
    const res = await fetch(`/api/crm/households/${householdId}/folders`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load folders (${res.status})`);
    const json = (await res.json()) as { folders: VaultFolder[] };
    setFolders(json.folders ?? []);
  }, [householdId]);

  const reloadDocs = useCallback(async () => {
    const q = selectedFolderId === null ? "root" : selectedFolderId;
    const res = await fetch(`/api/crm/households/${householdId}/documents?folderId=${q}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
    const json = (await res.json()) as { documents: VaultDoc[] };
    setDocs(json.documents ?? []);
  }, [householdId, selectedFolderId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([reloadFolders(), reloadDocs()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [reloadFolders, reloadDocs]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { folders, docs, loading, error, reload, reloadFolders, reloadDocs };
}
