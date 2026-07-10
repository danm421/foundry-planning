import type { VaultFolder } from "./use-portal-vault";

/** Human-readable file size. Bytes below 1 KB read as whole bytes; above that,
 *  one decimal in the largest unit that keeps the number under 1024. */
export function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || value % 1 === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Short, absolute upload date (e.g. "Jul 9, 2026"). */
export function formatDocDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Coarse file kind used only to pick a row icon. */
export type FileKind = "image" | "pdf" | "sheet" | "doc" | "file";

export function fileKind(mimeType: string | null, filename: string): FileKind {
  const mime = (mimeType ?? "").toLowerCase();
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg"].includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv" || ["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  if (mime.includes("word") || mime.includes("document") || ["doc", "docx", "txt", "rtf", "pages"].includes(ext)) return "doc";
  return "file";
}

/** Parse the served filename out of a Content-Disposition header, preferring the
 *  RFC 5987 `filename*` form and falling back to the quoted `filename`. Returns
 *  null when neither is present so the caller can fall back to the DTO name. */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return quoted?.[1]?.trim() || null;
}

export type FolderOption = { id: string; name: string; depth: number };

/** Depth-first flatten of the folder tree for a destination picker, rooted at
 *  "My Documents" (depth 0). Children are ordered by sortOrder then name. */
export function flattenFolderTree(folders: VaultFolder[], rootId: string | null): FolderOption[] {
  if (!rootId) return [];
  const childrenByParent = new Map<string, VaultFolder[]>();
  for (const f of folders) {
    if (f.isRoot) continue;
    const key = f.parentFolderId ?? rootId;
    const list = childrenByParent.get(key) ?? [];
    list.push(f);
    childrenByParent.set(key, list);
  }
  const out: FolderOption[] = [{ id: rootId, name: "My Documents", depth: 0 }];
  const walk = (parentId: string, depth: number) => {
    const children = (childrenByParent.get(parentId) ?? []).slice().sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    for (const child of children) {
      out.push({ id: child.id, name: child.name, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(rootId, 1);
  return out;
}

/** Breadcrumb chain from the root down to (and including) the current folder.
 *  Root is represented with id `null` so the caller can navigate back to it. */
export function folderAncestors(
  folders: VaultFolder[],
  currentFolderId: string | null,
  rootId: string | null,
): { id: string | null; name: string }[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: { id: string | null; name: string }[] = [];
  let cursor = currentFolderId;
  const seen = new Set<string>();
  while (cursor && cursor !== rootId && !seen.has(cursor)) {
    seen.add(cursor);
    const f = byId.get(cursor);
    if (!f) break;
    chain.unshift({ id: f.id, name: f.name });
    cursor = f.parentFolderId;
  }
  return [{ id: null, name: "My Documents" }, ...chain];
}
