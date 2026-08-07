import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tax-returns/document-text", () => ({ readDocumentText: vi.fn() }));
vi.mock("@/lib/tax-returns/classify-role", () => ({ classifyDocumentRole: vi.fn() }));
vi.mock("@/lib/tax-returns/extract-facts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-returns/extract-facts")>(
    "@/lib/tax-returns/extract-facts",
  );
  return { ...actual, extractTaxReturnFacts: vi.fn() };
});
vi.mock("@/lib/tax-returns/extract-supporting", () => ({ extractSupportingDocument: vi.fn() }));
vi.mock("@/lib/tax-returns/documents-store", () => ({
  getState: vi.fn(), insertDocument: vi.fn(), deleteDocument: vi.fn(),
}));
vi.mock("@/lib/tax-returns/recompute", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-returns/recompute")>(
    "@/lib/tax-returns/recompute",
  );
  return { ...actual, recomputeFacts: vi.fn() };
});

import { readDocumentText } from "@/lib/tax-returns/document-text";
import { classifyDocumentRole } from "@/lib/tax-returns/classify-role";
import { extractTaxReturnFacts } from "@/lib/tax-returns/extract-facts";
import { extractSupportingDocument } from "@/lib/tax-returns/extract-supporting";
import { getState, insertDocument, deleteDocument } from "@/lib/tax-returns/documents-store";
import { recomputeFacts } from "@/lib/tax-returns/recompute";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { MissingTaxReturnStateError } from "@/lib/tax-returns/errors";
import { addDocumentToReturn, TaxYearMismatchError } from "../add-document";

const RETURN_ID = "33333333-3333-3333-3333-333333333333";

function baseArgs(overrides: Partial<Parameters<typeof addDocumentToReturn>[0]> = {}) {
  return {
    taxReturnId: RETURN_ID, taxYear: 2024, buffer: Buffer.from("x"),
    filename: "k1.pdf", uploadKind: "pdf" as const, model: "mini" as const,
    role: "auto" as const, vaultDocumentId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readDocumentText).mockResolvedValue({ pages: ["K-1 2024"], warnings: [] });
  vi.mocked(getState).mockResolvedValue({ factsOverrides: {} } as never);
  vi.mocked(insertDocument).mockResolvedValue({ id: "doc-9" } as never);
  vi.mocked(recomputeFacts).mockResolvedValue(emptyTaxReturnFacts(2024));
});

function k1Extraction(taxYear = 2024) {
  const facts = emptyTaxReturnFacts(taxYear);
  facts.k1s = [{
    entityId: null, entityName: "Ridgeline", ein: "12-3456789", entityType: "partnership",
    ordinaryBusinessIncome: 180_000, rentalIncome: null, guaranteedPayments: null,
    section179: null, w2WagesFromEntity: null, qbiIncome: null, isSstb: null,
  }];
  return { taxYear, facts, payload: null, warnings: [], promptVersion: "supporting_document:x" };
}

describe("addDocumentToReturn", () => {
  it("classifies, extracts through the supporting lane, and recomputes", async () => {
    vi.mocked(classifyDocumentRole).mockResolvedValue("k1");
    vi.mocked(extractSupportingDocument).mockResolvedValue(k1Extraction());

    const result = await addDocumentToReturn(baseArgs());

    expect(result.role).toBe("k1");
    expect(extractTaxReturnFacts).not.toHaveBeenCalled();
    expect(getState).toHaveBeenCalledWith(RETURN_ID);
    expect(recomputeFacts).toHaveBeenCalledWith(RETURN_ID, 2024);
  });

  // The un-backfilled row is the WHOLE of production: `upsertExtracted` writes
  // `tax_returns` directly and creates neither a document nor a state row, and
  // the prod backfill has deliberately not run. Creating the state row here
  // would disarm `recomputeFacts`' guard and let the recompute below merge this
  // one document over the filed return — blanking every figure it does not
  // restate. Refusing is the only non-destructive answer.
  it("refuses a return with no state row instead of creating one", async () => {
    vi.mocked(classifyDocumentRole).mockResolvedValue("k1");
    vi.mocked(extractSupportingDocument).mockResolvedValue(k1Extraction());
    vi.mocked(getState).mockResolvedValue(null as never);

    await expect(addDocumentToReturn(baseArgs())).rejects.toThrow(MissingTaxReturnStateError);

    // Nothing was written and nothing was recomputed — a refused add leaves the
    // return byte-identical to how it started.
    expect(insertDocument).not.toHaveBeenCalled();
    expect(recomputeFacts).not.toHaveBeenCalled();
  });

  it("gates on the state row BEFORE inserting, so a refused add leaves no row behind", async () => {
    vi.mocked(classifyDocumentRole).mockResolvedValue("k1");
    vi.mocked(extractSupportingDocument).mockResolvedValue(k1Extraction());

    await addDocumentToReturn(baseArgs());

    const gateOrder = vi.mocked(getState).mock.invocationCallOrder[0];
    const insertOrder = vi.mocked(insertDocument).mock.invocationCallOrder[0];
    expect(gateOrder).toBeLessThan(insertOrder);
  });

  it("skips the classifier when the advisor named the role", async () => {
    vi.mocked(extractSupportingDocument).mockResolvedValue(k1Extraction());
    await addDocumentToReturn(baseArgs({ role: "k1" }));
    expect(classifyDocumentRole).not.toHaveBeenCalled();
  });

  it("routes a full_return through the 1040 extractor, not the supporting one", async () => {
    vi.mocked(classifyDocumentRole).mockResolvedValue("full_return");
    vi.mocked(extractTaxReturnFacts).mockResolvedValue({
      facts: emptyTaxReturnFacts(2024), isAmended: false,
      warnings: [], promptVersion: "tax_return_facts:x",
    });

    await addDocumentToReturn(baseArgs());

    expect(extractTaxReturnFacts).toHaveBeenCalled();
    expect(extractSupportingDocument).not.toHaveBeenCalled();
  });

  it("REJECTS a document whose year differs, naming both years", async () => {
    vi.mocked(classifyDocumentRole).mockResolvedValue("k1");
    vi.mocked(extractSupportingDocument).mockResolvedValue(k1Extraction(2023));

    const err = await addDocumentToReturn(baseArgs({ taxYear: 2024 })).catch((e) => e);

    expect(err).toBeInstanceOf(TaxYearMismatchError);
    expect(err.userMessage).toContain("2023");
    expect(err.userMessage).toContain("2024");
    expect(insertDocument).not.toHaveBeenCalled();
    expect(recomputeFacts).not.toHaveBeenCalled();
  });

  it("carries the text-reading warnings onto the stored document", async () => {
    vi.mocked(readDocumentText).mockResolvedValue({
      pages: ["K-1"], warnings: ["OCR was used — verify."],
    });
    vi.mocked(classifyDocumentRole).mockResolvedValue("k1");
    vi.mocked(extractSupportingDocument).mockResolvedValue({
      ...k1Extraction(), warnings: ["Truncated."],
    });

    await addDocumentToReturn(baseArgs());

    const stored = vi.mocked(insertDocument).mock.calls[0][0];
    expect(stored.warnings).toEqual(["OCR was used — verify.", "Truncated."]);
    expect(stored.role).toBe("k1");
    expect(stored.taxYear).toBe(2024);
  });

  it("REJECTS a full_return whose year differs too — the gate isn't lane-specific", async () => {
    vi.mocked(classifyDocumentRole).mockResolvedValue("full_return");
    vi.mocked(extractTaxReturnFacts).mockResolvedValue({
      facts: emptyTaxReturnFacts(2023), isAmended: false,
      warnings: [], promptVersion: "tax_return_facts:x",
    });

    const err = await addDocumentToReturn(baseArgs({ taxYear: 2024 })).catch((e) => e);

    expect(err).toBeInstanceOf(TaxYearMismatchError);
    expect(insertDocument).not.toHaveBeenCalled();
    expect(recomputeFacts).not.toHaveBeenCalled();
  });

  it("deletes the just-inserted row and rethrows the original error when recompute fails", async () => {
    vi.mocked(classifyDocumentRole).mockResolvedValue("k1");
    vi.mocked(extractSupportingDocument).mockResolvedValue(k1Extraction());
    vi.mocked(insertDocument).mockResolvedValue({ id: "doc-9", warnings: [] } as never);
    const recomputeError = new Error("boom");
    vi.mocked(recomputeFacts).mockRejectedValue(recomputeError);

    const err = await addDocumentToReturn(baseArgs()).catch((e) => e);

    expect(err).toBe(recomputeError);
    expect(deleteDocument).toHaveBeenCalledWith(RETURN_ID, "doc-9");
  });
});
