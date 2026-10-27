// src/lib/fact-finder/worksheet/__tests__/page-text.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportFileRow } from "../../persist";

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
vi.mock("../../chat/document-text", () => ({ readDocumentPages: vi.fn() }));

import { readDocumentPages } from "../../chat/document-text";
import { documentPages } from "../page-text";

const file: ImportFileRow = { id: "f1", blobUrl: "blob://f1", originalFilename: "f1.pdf", detectedKind: "pdf", documentType: "auto" };

beforeEach(() => {
  vi.clearAllMocks();
  blob.store.clear();
});

describe("documentPages", () => {
  it("documentPages reads the sidecar the second time", async () => {
    vi.mocked(readDocumentPages).mockResolvedValue(["page one", "page two"]);
    expect(await documentPages("i1", file)).toEqual(["page one", "page two"]);
    expect(await documentPages("i1", file)).toEqual(["page one", "page two"]);
    expect(readDocumentPages).toHaveBeenCalledTimes(1);
  });

  it("documentPages saves what it read to the sidecar", async () => {
    vi.mocked(readDocumentPages).mockResolvedValue(["only page"]);
    await documentPages("i1", file);
    expect(blob.store.get("imports/i1/f1.pages.json")).toBe('["only page"]');
  });
});
