import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/extract", () => ({ extractDocument: vi.fn() }));
vi.mock("@/lib/imports/blob", () => ({
  downloadImportFile: vi.fn(async () => Buffer.from("x")),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// Minimal @/db stub: mirrors the pattern in gate.test.ts.
// The extraction loop makes these queries in sequence:
//   1. select files WHERE importId = ?  → one file row
//   2. select import row WHERE id = ?   → one import row (with .limit())
//   3. insert clientImportExtractions   → { id: "ext1" }
//   4. update clientImportExtractions   → no-op
//   5. update clientImports             → no-op
let selectCallCount = 0;

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      selectCallCount++;
      const callIndex = selectCallCount;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (callIndex === 1) {
              // First select: files — returns array directly (no .limit())
              return Promise.resolve([
                {
                  id: "f1",
                  blobUrl: "https://blob/a.pdf",
                  originalFilename: "a.pdf",
                  documentType: "auto",
                  detectedKind: "pdf",
                  importId: "imp1",
                  deletedAt: null,
                },
              ]);
            }
            // Second select: import row — supports .limit() chaining
            return {
              limit: vi.fn(() =>
                Promise.resolve([
                  {
                    id: "imp1",
                    payloadJson: null,
                    extractHoldings: false,
                    status: "draft",
                  },
                ])
              ),
            };
          }),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: "ext1" }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

import { runImportExtraction } from "../run-extraction";
import { extractDocument } from "@/lib/extraction/extract";

beforeEach(() => {
  vi.mocked(extractDocument).mockReset();
  selectCallCount = 0;
});

describe("runImportExtraction", () => {
  it("runs comprehensive extraction and returns review status", async () => {
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "fact_finder",
      fileName: "a.pdf",
      extracted: {
        accounts: [{ name: "x" }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
      },
      warnings: [],
      promptVersion: "multi-pass:v",
    } as never);

    const res = await runImportExtraction({
      importId: "imp1",
      clientId: "c1",
      firmId: "org_A",
      model: "mini",
      extractHoldings: false,
      comprehensive: true,
    });

    expect(extractDocument).toHaveBeenCalledWith(
      expect.anything(),
      "a.pdf",
      "auto",
      "mini",
      "pdf",
      false,
      true,
    );
    expect(res.status).toBe("review");
    expect(res.succeeded).toBe(1);
  });
});
