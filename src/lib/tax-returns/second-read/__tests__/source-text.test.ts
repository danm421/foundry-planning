import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCrmDocument, resolveDocumentBlobPathname, downloadImportFile, readDocumentText } =
  vi.hoisted(() => ({
    getCrmDocument: vi.fn(),
    resolveDocumentBlobPathname: vi.fn(),
    downloadImportFile: vi.fn(),
    readDocumentText: vi.fn(),
  }));

vi.mock("@/lib/crm/documents", () => ({ getCrmDocument, resolveDocumentBlobPathname }));
vi.mock("@/lib/imports/blob", () => ({ downloadImportFile }));
vi.mock("../../document-text", () => ({ readDocumentText }));

import { loadDocumentSourceText } from "../source-text";

const PDF = Buffer.from("%PDF-1.4\n");

function doc(over: Partial<{ id: string; role: string; filename: string | null; vaultDocumentId: string | null }> = {}) {
  return {
    id: "d1", role: "full_return", filename: "1040.pdf",
    vaultDocumentId: "v1", ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCrmDocument.mockResolvedValue({ id: "v1", householdId: "h1" });
  resolveDocumentBlobPathname.mockResolvedValue("crm/h1/plans/1040.pdf");
  downloadImportFile.mockResolvedValue(PDF);
  readDocumentText.mockResolvedValue({ pages: ["Form 1040 page one"], warnings: [] });
});

describe("loadDocumentSourceText", () => {
  it("returns one source per readable document", async () => {
    const result = await loadDocumentSourceText([doc()]);
    expect(result.sources).toEqual([
      { documentId: "d1", role: "full_return", filename: "1040.pdf", text: "Form 1040 page one" },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("only ever forwards text that came from readDocumentText — the redacting reader", async () => {
    readDocumentText.mockResolvedValue({ pages: ["SSN [redacted]"], warnings: [] });
    const result = await loadDocumentSourceText([doc()]);
    expect(result.sources[0].text).toBe("SSN [redacted]");
    // The buffer is handed to readDocumentText, never read any other way.
    expect(readDocumentText).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: PDF, uploadKind: "pdf" }),
    );
  });

  it("warns and skips a document that was never saved to the vault", async () => {
    const result = await loadDocumentSourceText([doc({ vaultDocumentId: null, filename: "k1.pdf" })]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toEqual(["k1.pdf isn't in the document vault, so it wasn't read."]);
    expect(getCrmDocument).not.toHaveBeenCalled();
  });

  it("warns and skips when the blob is gone", async () => {
    downloadImportFile.mockResolvedValue(null);
    const result = await loadDocumentSourceText([doc()]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toEqual(["1040.pdf couldn't be read from the document vault."]);
  });

  it("warns and skips when the vault link is stale (no pathname)", async () => {
    resolveDocumentBlobPathname.mockResolvedValue(null);
    const result = await loadDocumentSourceText([doc()]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toEqual(["1040.pdf couldn't be read from the document vault."]);
  });

  it("warns and skips when re-reading throws — one bad scan never fails the run", async () => {
    readDocumentText.mockRejectedValue(new Error("no text layer and OCR produced nothing"));
    const result = await loadDocumentSourceText([doc({ filename: null })]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toEqual(["A document couldn't be read from the document vault."]);
  });

  it("keeps the readable documents when one of several fails", async () => {
    downloadImportFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(PDF);
    const result = await loadDocumentSourceText([
      doc({ id: "d1", filename: "bad.pdf" }),
      doc({ id: "d2", filename: "k1.pdf", role: "k1" }),
    ]);
    expect(result.sources.map((s) => s.documentId)).toEqual(["d2"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("warns and skips a blob whose bytes are not a document we can read", async () => {
    downloadImportFile.mockResolvedValue(Buffer.from("not a pdf at all"));
    const result = await loadDocumentSourceText([doc()]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toEqual(["1040.pdf couldn't be read from the document vault."]);
    expect(readDocumentText).not.toHaveBeenCalled();
  });
});
