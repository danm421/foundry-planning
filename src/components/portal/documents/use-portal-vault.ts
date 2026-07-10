"use client";
import { useCallback, useEffect, useState } from "react";
import { usePortalFetch } from "@/components/portal/portal-mode-context";

export type VaultFolder = { id: string; name: string; parentFolderId: string | null; sortOrder: number; isRoot: boolean };
export type VaultDoc = { id: string; filename: string; description: string | null; sizeBytes: number | null; mimeType: string | null; createdAt: string; folderId: string | null };

export function usePortalVault() {
  const portalFetch = usePortalFetch();
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [rootId, setRootId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null); // null = root
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadFolders = useCallback(async () => {
    try {
      const res = await portalFetch("/api/portal/folders", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load folders (${res.status})`);
      const json = (await res.json()) as { rootId: string; folders: VaultFolder[] };
      setRootId(json.rootId);
      setFolders(json.folders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [portalFetch]);

  const reloadDocs = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = currentFolderId ?? "root";
      const res = await portalFetch(`/api/portal/documents?folderId=${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      const json = (await res.json()) as { documents: VaultDoc[] };
      setDocs(json.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [portalFetch, currentFolderId]);

  useEffect(() => { void reloadFolders(); }, [reloadFolders]);
  useEffect(() => { void reloadDocs(); }, [reloadDocs]);

  const reload = useCallback(async () => { await Promise.all([reloadFolders(), reloadDocs()]); }, [reloadFolders, reloadDocs]);

  return { folders, rootId, docs, currentFolderId, setCurrentFolderId, loading, error, reload, portalFetch };
}
