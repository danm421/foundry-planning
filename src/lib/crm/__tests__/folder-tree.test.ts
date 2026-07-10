import { describe, it, expect } from "vitest";
import { buildFolderTree, collectFolderSubtreeIds } from "../folder-tree";

type F = { id: string; name: string; parentFolderId: string | null; sortOrder: number };

const folders: F[] = [
  { id: "a", name: "A", parentFolderId: null, sortOrder: 0 },
  { id: "b", name: "B", parentFolderId: "a", sortOrder: 0 },
  { id: "c", name: "C", parentFolderId: "a", sortOrder: 1 },
  { id: "d", name: "D", parentFolderId: "b", sortOrder: 0 },
  { id: "e", name: "E", parentFolderId: null, sortOrder: 1 },
];

describe("buildFolderTree", () => {
  it("nests children under parents, ordered by sortOrder", () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((n) => n.id)).toEqual(["a", "e"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["b", "c"]);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(["d"]);
  });

  it("treats a missing/unknown parent as a root node (no orphans lost)", () => {
    const tree = buildFolderTree([
      { id: "x", name: "X", parentFolderId: "ghost", sortOrder: 0 },
    ]);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });
});

describe("collectFolderSubtreeIds", () => {
  it("returns the folder plus all descendants", () => {
    expect(new Set(collectFolderSubtreeIds(folders, "a"))).toEqual(
      new Set(["a", "b", "c", "d"]),
    );
  });
  it("returns just the folder when it has no children", () => {
    expect(collectFolderSubtreeIds(folders, "e")).toEqual(["e"]);
  });

  it("terminates and dedupes when the input contains a parent cycle", () => {
    // Malformed/corrupted data: a <-> b form a cycle via parentFolderId,
    // with c hanging off b. A visited-set guard is required for this to
    // terminate at all; without it the stack grows unbounded.
    const cyclic: F[] = [
      { id: "a", name: "A", parentFolderId: "b", sortOrder: 0 },
      { id: "b", name: "B", parentFolderId: "a", sortOrder: 0 },
      { id: "c", name: "C", parentFolderId: "b", sortOrder: 0 },
    ];
    const result = collectFolderSubtreeIds(cyclic, "a");
    expect(new Set(result)).toEqual(new Set(["a", "b", "c"]));
    expect(result.length).toBe(new Set(result).size);
  });
});
