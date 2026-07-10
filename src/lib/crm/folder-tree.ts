export type FolderLike = {
  id: string;
  name: string;
  parentFolderId: string | null;
  sortOrder: number;
};

export type FolderNode<T extends FolderLike> = T & { children: FolderNode<T>[] };

/** Build a nested tree from a flat folder list. A node whose parent id is not
 *  present in the list is promoted to a root (orphans are never dropped). */
export function buildFolderTree<T extends FolderLike>(folders: T[]): FolderNode<T>[] {
  const byId = new Map<string, FolderNode<T>>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });

  const roots: FolderNode<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.parentFolderId ? byId.get(node.parentFolderId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: FolderNode<T>[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** All folder ids in the subtree rooted at `rootId` (inclusive). */
export function collectFolderSubtreeIds<T extends FolderLike>(
  folders: T[],
  rootId: string,
): string[] {
  const childrenByParent = new Map<string, T[]>();
  for (const f of folders) {
    if (!f.parentFolderId) continue;
    const arr = childrenByParent.get(f.parentFolderId) ?? [];
    arr.push(f);
    childrenByParent.set(f.parentFolderId, arr);
  }
  const out: string[] = [];
  const visited = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    out.push(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child.id);
  }
  return out;
}
