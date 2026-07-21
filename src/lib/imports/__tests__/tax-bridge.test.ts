import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tax-returns/extract-facts", () => ({
  extractTaxReturnFacts: vi.fn(),
  TaxReturnExtractionError: class extends Error {},
}));
vi.mock("@/lib/tax-returns/store", () => ({ upsertExtracted: vi.fn() }));

import { extractTaxReturnFacts } from "@/lib/tax-returns/extract-facts";
import { upsertExtracted } from "@/lib/tax-returns/store";
import { bridgeTaxReturn } from "../tax-bridge";

const ARGS = {
  buffer: Buffer.from("x"),
  filename: "1040.pdf",
  clientId: "c1",
  kind: "pdf" as const,
  model: "full" as const,
};

beforeEach(() => vi.clearAllMocks());

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
});
