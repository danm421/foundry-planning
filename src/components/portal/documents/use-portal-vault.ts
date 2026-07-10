"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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

  // Stale-response guard: rapid folder A→B switching (or a reload racing a
  // folder change) can otherwise resolve out of order and render A's docs under
  // B's breadcrumb. Each call aborts the in-flight request and only the latest
  // one is allowed to commit into state.
  const docsAbortRef = useRef<AbortController | null>(null);
  const reloadDocs = useCallback(async () => {
    docsAbortRef.current?.abort();
    const controller = new AbortController();
    docsAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const q = currentFolderId ?? "root";
      const res = await portalFetch(`/api/portal/documents?folderId=${q}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      const json = (await res.json()) as { documents: VaultDoc[] };
      setDocs(json.documents ?? []);
    } catch (e) {
      // A superseded request rejects with AbortError — ignore it so the newer
      // request's result (and loading state) is never clobbered.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Only the still-active request may clear the spinner; an aborted one
      // leaves it up for its successor.
      if (docsAbortRef.current === controller) setLoading(false);
    }
  }, [portalFetch, currentFolderId]);

  useEffect(() => { void reloadFolders(); }, [reloadFolders]);
  useEffect(() => { void reloadDocs(); }, [reloadDocs]);
  useEffect(() => () => docsAbortRef.current?.abort(), []);

  const reload = useCallback(async () => { await Promise.all([reloadFolders(), reloadDocs()]); }, [reloadFolders, reloadDocs]);

  return { folders, rootId, docs, currentFolderId, setCurrentFolderId, loading, error, setError, reload, reloadDocs, portalFetch };
}
