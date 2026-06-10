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
});
