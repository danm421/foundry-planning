import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tax-returns/extract-facts", () => ({
  extractTaxReturnFacts: vi.fn(),
  TaxReturnExtractionError: class extends Error {},
}));
vi.mock("@/lib/tax-returns/store", () => ({ getTaxReturn: vi.fn(), upsertExtracted: vi.fn() }));

import { extractTaxReturnFacts } from "@/lib/tax-returns/extract-facts";
import { getTaxReturn, upsertExtracted } from "@/lib/tax-returns/store";
import { bridgeTaxReturn } from "../tax-bridge";

const ARGS = {
  buffer: Buffer.from("x"),
  filename: "1040.pdf",
  clientId: "c1",
  kind: "pdf" as const,
  model: "full" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTaxReturn).mockResolvedValue(null);
});

describe("bridgeTaxReturn", () => {
  it("stores the extracted facts under the return's own tax year", async () => {
    vi.mocked(extractTaxReturnFacts).mockResolvedValue({
      facts: { taxYear: 2025, income: { agi: 124624 }, tax: { totalTax: 14210 } },
      isAmended: false,
      warnings: ["ok"],
      promptVersion: "v3",
    } as unknown as Awaited<ReturnType<typeof extractTaxReturnFacts>>);

    const res = await bridgeTaxReturn(ARGS);

    expect(res.ok).toBe(true);
    expect(upsertExtracted).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1",
        taxYear: 2025,
        promptVersion: "v3",
        sourceFilename: "1040.pdf",
        vaultDocumentId: null,
      }),
    );
  });

  it("degrades to a warning and never throws when extraction fails", async () => {
    vi.mocked(extractTaxReturnFacts).mockRejectedValue(new Error("azure 400"));

    const res = await bridgeTaxReturn(ARGS);

    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/tax analysis/i);
    expect(upsertExtracted).not.toHaveBeenCalled();
  });

  it("degrades when the store write fails — the import must still succeed", async () => {
    vi.mocked(extractTaxReturnFacts).mockResolvedValue({
      facts: { taxYear: 2025 },
      isAmended: false,
      warnings: [],
      promptVersion: "v3",
    } as unknown as Awaited<ReturnType<typeof extractTaxReturnFacts>>);
    vi.mocked(upsertExtracted).mockRejectedValue(new Error("db down"));

    const res = await bridgeTaxReturn(ARGS);
    expect(res.ok).toBe(false);
    expect(res.warning).toMatch(/tax analysis/i);
  });

  it("does not overwrite a year the advisor already reviewed", async () => {
    vi.mocked(extractTaxReturnFacts).mockResolvedValue({
      facts: { taxYear: 2024 },
      isAmended: false,
      warnings: [],
      promptVersion: "v3",
    } as unknown as Awaited<ReturnType<typeof extractTaxReturnFacts>>);
    vi.mocked(getTaxReturn).mockResolvedValue({
      id: "row-1",
      taxYear: 2024,
      status: "ready",
    } as unknown as Awaited<ReturnType<typeof getTaxReturn>>);

    const res = await bridgeTaxReturn(ARGS);

    expect(upsertExtracted).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.warning).toContain("2024");
  });

  it("writes when no return exists for that year", async () => {
    vi.mocked(extractTaxReturnFacts).mockResolvedValue({
      facts: { taxYear: 2025 },
      isAmended: false,
      warnings: [],
      promptVersion: "v3",
    } as unknown as Awaited<ReturnType<typeof extractTaxReturnFacts>>);
    vi.mocked(upsertExtracted).mockResolvedValue({
      id: "row-1",
    } as unknown as Awaited<ReturnType<typeof upsertExtracted>>);
    // getTaxReturn defaults to resolving null in beforeEach.

    const res = await bridgeTaxReturn(ARGS);

    expect(upsertExtracted).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
  });
});
