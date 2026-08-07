import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: vi.fn() }));

import { callAIExtraction } from "@/lib/extraction/azure-client";
import { extractSupportingDocument } from "../extract-supporting";
import { TaxReturnExtractionError } from "../errors";

beforeEach(() => vi.clearAllMocks());

const K1_RESPONSE = JSON.stringify({
  taxYear: 2024,
  k1s: [{
    entityName: "Ridgeline Partners LLC", ein: "12-3456789", entityType: "partnership",
    ordinaryBusinessIncome: 180_000, rentalIncome: null, guaranteedPayments: 60_000,
    section179: null, qbiIncome: 180_000, isSstb: false,
  }],
  w2s: [],
});

describe("extractSupportingDocument", () => {
  it("returns facts carrying only k1s — every 1040 aggregate stays null", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(K1_RESPONSE);
    const result = await extractSupportingDocument({
      pages: ["Schedule K-1"], role: "k1", model: "mini",
    });

    expect(result.taxYear).toBe(2024);
    expect(result.facts?.k1s).toHaveLength(1);
    expect(result.facts?.k1s[0].ein).toBe("12-3456789");
    expect(result.facts?.k1s[0].guaranteedPayments).toBe(60_000);
    // The whole point of the compact prompt: no 1040 lines come back at all.
    expect(result.facts?.income.wages).toBeNull();
    expect(result.facts?.income.agi).toBeNull();
    expect(result.facts?.deductions.taxableIncome).toBeNull();
  });

  it("never stamps an entityId — identity is minted at MERGE time, not extraction", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(K1_RESPONSE);
    const result = await extractSupportingDocument({
      pages: ["Schedule K-1"], role: "k1", model: "mini",
    });
    expect(result.facts?.k1s[0].entityId).toBeNull();
  });

  it("never populates w2WagesFromEntity — that is an advisor assignment only", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({
        taxYear: 2024,
        k1s: [{
          entityName: "Ridgeline", ein: null, entityType: "s_corp",
          ordinaryBusinessIncome: 1, rentalIncome: null, guaranteedPayments: null,
          section179: null, qbiIncome: null, isSstb: null,
          w2WagesFromEntity: 95_000, // model volunteered it; must be discarded
        }],
        w2s: [],
      }),
    );
    const result = await extractSupportingDocument({
      pages: ["K-1"], role: "k1", model: "mini",
    });
    expect(result.facts?.k1s[0].w2WagesFromEntity).toBeNull();
  });

  it("puts W-2 pairs in the payload and contributes NO facts", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({
        taxYear: 2024, k1s: [],
        w2s: [{ employer: "Ridgeline Partners LLC", wages: 95_000 }],
      }),
    );
    const result = await extractSupportingDocument({
      pages: ["Form W-2"], role: "w2", model: "mini",
    });
    expect(result.payload?.w2s).toEqual([{ employer: "Ridgeline Partners LLC", wages: 95_000 }]);
    expect(result.facts).toBeNull();
  });

  it("reads only the tax year for an 'other' document — it contributes nothing else", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({ taxYear: 2024, k1s: [], w2s: [] }),
    );
    const result = await extractSupportingDocument({
      pages: ["Preparer letter"], role: "other", model: "mini",
    });
    expect(result.taxYear).toBe(2024);
    expect(result.facts).toBeNull();
    expect(result.payload).toBeNull();
  });

  // D6 — the ROLE decides what a document may contribute, never the model's
  // output. Both directions matter: without these, inverting either gate
  // (`role === "k1"` ↔ `role === "w2"`) leaves every other test green, and a
  // W-2 would be free to write 1040-adjacent K-1 facts.
  it("keeps the payload null on a k1 even when the model returns W-2 pairs", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({
        taxYear: 2024,
        k1s: [{
          entityName: "Ridgeline", ein: null, entityType: "partnership",
          ordinaryBusinessIncome: 180_000, rentalIncome: null, guaranteedPayments: null,
          section179: null, qbiIncome: null, isSstb: null,
        }],
        w2s: [{ employer: "Ridgeline Partners LLC", wages: 95_000 }],
      }),
    );
    const result = await extractSupportingDocument({
      pages: ["Schedule K-1"], role: "k1", model: "mini",
    });

    expect(result.payload).toBeNull();
    expect(result.facts?.k1s).toHaveLength(1);
  });

  it("keeps facts null on a w2 even when the model returns K-1s", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({
        taxYear: 2024,
        k1s: [{
          entityName: "Ridgeline", ein: null, entityType: "partnership",
          ordinaryBusinessIncome: 180_000, rentalIncome: null, guaranteedPayments: null,
          section179: null, qbiIncome: null, isSstb: null,
        }],
        w2s: [{ employer: "Ridgeline Partners LLC", wages: 95_000 }],
      }),
    );
    const result = await extractSupportingDocument({
      pages: ["Form W-2"], role: "w2", model: "mini",
    });

    expect(result.facts).toBeNull();
    expect(result.payload?.w2s).toHaveLength(1);
  });

  it("throws a user-safe error when the document states no tax year", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({ taxYear: null, k1s: [], w2s: [] }),
    );
    await expect(
      extractSupportingDocument({ pages: ["K-1"], role: "k1", model: "mini" }),
    ).rejects.toBeInstanceOf(TaxReturnExtractionError);
  });
});
