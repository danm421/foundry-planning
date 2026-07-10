"use client";
import { useMemo } from "react";
import { usePortalVault } from "./documents/use-portal-vault";

export function PortalDocumentsScreen({ clientId: _clientId }: { clientId: string }) {
  const v = usePortalVault();
  const byId = useMemo(() => new Map(v.folders.map((f) => [f.id, f])), [v.folders]);
  const childrenOf = (id: string | null) =>
    v.folders.filter((f) => (id === null ? f.isRoot ? false : f.parentFolderId === v.rootId : f.parentFolderId === id));

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    if (v.currentFolderId) fd.append("folderId", v.currentFolderId);
    const res = await v.portalFetch("/api/portal/documents", { method: "POST", body: fd });
    if (res.ok) await v.reload();
  }
  async function del(id: string) {
    const res = await v.portalFetch(`/api/portal/documents/${id}`, { method: "DELETE" });
    if (res.ok) await v.reload();
  }
  async function newFolder() {
    const name = window.prompt("Folder name");
    if (!name) return;
    const res = await v.portalFetch("/api/portal/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentFolderId: v.currentFolderId }),
    });
    if (res.ok) await v.reload();
  }

  return (
    <div>
      {v.error && <p role="alert">{v.error}</p>}
      <button onClick={() => v.setCurrentFolderId(null)}>My Documents</button>
      {v.currentFolderId && <span> / {byId.get(v.currentFolderId)?.name}</span>}
      <div>
        <label>Upload<input type="file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        <button onClick={newFolder}>New folder</button>
      </div>
      <ul>
        {childrenOf(v.currentFolderId).map((f) => (
          <li key={f.id}><button onClick={() => v.setCurrentFolderId(f.id)}>📁 {f.name}</button></li>
        ))}
      </ul>
      <ul>
        {v.loading ? <li>Loading…</li> : v.docs.map((d) => (
          <li key={d.id}>
            <a href={`/api/portal/documents/${d.id}`}>{d.filename}</a>
            <button onClick={() => del(d.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
