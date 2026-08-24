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
// Controls what the import-row SELECT (call 2) returns
let importRowResult: unknown[] = [
  { id: "imp1", payloadJson: null, extractHoldings: false, status: "draft" },
];

function fileRow(id: string, name: string) {
  return {
    id,
    blobUrl: `https://blob/${name}`,
    originalFilename: name,
    documentType: "auto",
    detectedKind: "pdf",
    importId: "imp1",
    deletedAt: null,
  };
}

// Controls what the files SELECT (call 1) returns
let filesResult: unknown[] = [fileRow("f1", "a.pdf")];

/** A stored ExtractionResult carrying one account — enough to count as usable. */
function storedResult(name: string, accountName: string) {
  return {
    documentType: "fact_finder",
    fileName: name,
    extracted: {
      accounts: [{ name: accountName }],
      incomes: [],
      expenses: [],
      liabilities: [],
      entities: [],
      lifePolicies: [],
      wills: [],
    },
    warnings: [],
    promptVersion: "v",
  };
}

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
              return Promise.resolve(filesResult);
            }
            // Second select: import row — supports .limit() chaining
            return {
              limit: vi.fn(() => Promise.resolve(importRowResult)),
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
import { recordAudit } from "@/lib/audit";

beforeEach(() => {
  vi.mocked(extractDocument).mockReset();
  vi.mocked(recordAudit).mockReset();
  selectCallCount = 0;
  filesResult = [fileRow("f1", "a.pdf")];
  importRowResult = [
    { id: "imp1", payloadJson: null, extractHoldings: false, status: "draft" },
  ];
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

    // Audit assertions: both started and completed must be recorded.
    const auditCalls = vi.mocked(recordAudit).mock.calls.map((c) => c[0].action);
    expect(auditCalls).toContain("import.extraction.started");
    expect(auditCalls).toContain("import.extraction.completed");
  });

  // The onboarding drawer lets an advisor add documents to an import that has
  // already been read. Only the new file may go to the model — re-reading the
  // rest pays for them twice and can outrun the extract route's 300s ceiling.
  it("with skipExtracted, only reads files that have no stored result", async () => {
    filesResult = [fileRow("f1", "a.pdf"), fileRow("f2", "b.pdf")];
    importRowResult = [
      {
        id: "imp1",
        payloadJson: {
          fileResults: {
            f1: storedResult("a.pdf", "already here"),
          },
        },
        extractHoldings: false,
        status: "review",
      },
    ];
    vi.mocked(extractDocument).mockResolvedValue(
      storedResult("b.pdf", "new") as never,
    );

    const res = await runImportExtraction({
      importId: "imp1",
      clientId: "c1",
      firmId: "org_A",
      model: "mini",
      extractHoldings: false,
      skipExtracted: true,
    });

    expect(extractDocument).toHaveBeenCalledTimes(1);
    expect(vi.mocked(extractDocument).mock.calls[0][1]).toBe("b.pdf");
    expect(res.succeeded).toBe(1);
    expect(res.status).toBe("review");
  });

  it("with skipExtracted and nothing new, reads nothing and keeps review status", async () => {
    importRowResult = [
      {
        id: "imp1",
        payloadJson: {
          fileResults: {
            f1: storedResult("a.pdf", "already here"),
          },
        },
        extractHoldings: false,
        status: "review",
      },
    ];

    const res = await runImportExtraction({
      importId: "imp1",
      clientId: "c1",
      firmId: "org_A",
      model: "mini",
      extractHoldings: false,
      skipExtracted: true,
    });

    expect(extractDocument).not.toHaveBeenCalled();
    expect(res).toEqual({
      succeeded: 0,
      failed: 0,
      status: "review",
      warnings: [],
    });
  });

  it("without skipExtracted, re-reads a file that already has a result", async () => {
    importRowResult = [
      {
        id: "imp1",
        payloadJson: {
          fileResults: {
            f1: storedResult("a.pdf", "already here"),
          },
        },
        extractHoldings: false,
        status: "review",
      },
    ];
    vi.mocked(extractDocument).mockResolvedValue(
      storedResult("a.pdf", "re-read") as never,
    );

    await runImportExtraction({
      importId: "imp1",
      clientId: "c1",
      firmId: "org_A",
      model: "mini",
      extractHoldings: false,
    });

    expect(extractDocument).toHaveBeenCalledTimes(1);
  });

  it("throws Import not found when the import row is missing", async () => {
    importRowResult = []; // no import row returned

    await expect(
      runImportExtraction({
        importId: "ghost-imp",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
        comprehensive: false,
      }),
    ).rejects.toThrow(/Import not found/);

    expect(extractDocument).not.toHaveBeenCalled();
  });
});
