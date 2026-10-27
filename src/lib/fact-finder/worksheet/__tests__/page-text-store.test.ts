// src/lib/fact-finder/worksheet/__tests__/page-text-store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  return { BlobNotFoundError, store: new Map<string, string>() };
});

vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: blob.BlobNotFoundError,
  put: vi.fn(async (pathname: string, body: string) => {
    blob.store.set(pathname, body);
    return { url: `https://blob/${pathname}`, pathname };
  }),
  get: vi.fn(async (pathname: string) => {
    const body = blob.store.get(pathname);
    if (body === undefined) return null;
    return { statusCode: 200, stream: new Response(body).body };
  }),
  del: vi.fn(async (pathname: string) => {
    if (!blob.store.delete(pathname)) throw new blob.BlobNotFoundError();
  }),
}));

import { put } from "@vercel/blob";
import { deletePageText, pageTextPathname, savePageText } from "../page-text-store";


beforeEach(() => {
  vi.clearAllMocks();
  blob.store.clear();
});

describe("page text store", () => {
  it("lives at imports/<import>/<file>.pages.json, private, overwrite allowed", async () => {
    expect(pageTextPathname("i1", "f1")).toBe("imports/i1/f1.pages.json");
    await savePageText("i1", "f1", ["a"]);
    expect(put).toHaveBeenCalledWith("imports/i1/f1.pages.json", '["a"]', expect.objectContaining({ access: "private", allowOverwrite: true }));
  });

  it("deletePageText removes the sidecar and ignores a missing blob", async () => {
    await savePageText("i1", "f1", ["a"]);
    await deletePageText("i1", "f1");
    expect(blob.store.size).toBe(0);
    await expect(deletePageText("i1", "f1")).resolves.toBeUndefined();
  });
});
