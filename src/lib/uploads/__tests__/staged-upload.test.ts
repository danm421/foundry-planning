import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const mockGet = vi.fn();
const mockDel = vi.fn();
const mockGenerateClientToken = vi.fn();
vi.mock("@vercel/blob", () => ({
  get: (...args: unknown[]) => mockGet(...args),
  del: (...args: unknown[]) => mockDel(...args),
}));
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => mockGenerateClientToken(...args),
}));

import { issueStagedUpload, stagingPrefix, takeStagedUpload, StagedUploadError } from "../staged-upload";

const PREFIX = stagingPrefix("test", "client-a");

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDel.mockResolvedValue(undefined);
});

describe("issueStagedUpload", () => {
  it("issues a 50 MB token for one fresh pathname under the prefix", async () => {
    mockGenerateClientToken.mockResolvedValue("client-token");
    const { pathname, clientToken } = await issueStagedUpload(PREFIX, "Smith 2025 1040.pdf");
    expect(clientToken).toBe("client-token");
    expect(pathname).toMatch(/^staging\/test\/client-a\/\d+-[0-9a-f-]{36}-Smith_2025_1040\.pdf$/);
    expect(mockGenerateClientToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname, maximumSizeInBytes: 50 * 1024 * 1024 }),
    );
  });
});

describe("takeStagedUpload", () => {
  const issued = () => `${PREFIX}${Date.now()}-${randomUUID()}-return.pdf`;

  it("returns the bytes, then deletes the staged copy", async () => {
    const pathname = issued();
    mockGet.mockResolvedValue({ stream: streamOf("%PDF-1.7 body") });
    const buffer = await takeStagedUpload(PREFIX, pathname);
    expect(buffer.toString()).toBe("%PDF-1.7 body");
    expect(mockGet).toHaveBeenCalledWith(pathname, { access: "private" });
    expect(mockDel).toHaveBeenCalledWith(pathname);
  });

  it.each([[null], [""], [new Blob(["%PDF"])]])("400s when no staged pathname is sent (%s)", async (value) => {
    const err = await takeStagedUpload(PREFIX, value).catch((e) => e);
    expect(err).toBeInstanceOf(StagedUploadError);
    expect(err.status).toBe(400);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it.each([
    ["another client's prefix", `staging/test/client-b/${Date.now()}-${randomUUID()}-return.pdf`],
    ["a climb out of the prefix", `${PREFIX}../client-b/${Date.now()}-${randomUUID()}-return.pdf`],
    ["a nested segment", `${PREFIX}${Date.now()}-${randomUUID()}-x/return.pdf`],
    ["a backslash climb", `${PREFIX}${Date.now()}-${randomUUID()}-..\\return.pdf`],
    ["a pathname the issuer never mints", `${PREFIX}return.pdf`],
  ])("404s %s without reading or deleting anything", async (_label, pathname) => {
    const err = await takeStagedUpload(PREFIX, pathname).catch((e) => e);
    expect(err).toBeInstanceOf(StagedUploadError);
    expect(err.status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("404s a staged upload that is already gone", async () => {
    mockGet.mockResolvedValue(null);
    const err = await takeStagedUpload(PREFIX, issued()).catch((e) => e);
    expect(err).toBeInstanceOf(StagedUploadError);
    expect(err.status).toBe(404);
  });

  it("still deletes the staged copy when the read fails", async () => {
    const pathname = issued();
    mockGet.mockRejectedValue(new Error("network"));
    await expect(takeStagedUpload(PREFIX, pathname)).rejects.toThrow("network");
    expect(mockDel).toHaveBeenCalledWith(pathname);
  });
});
