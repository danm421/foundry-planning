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
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn(() => {
          // Only the `clientImports` aggregate write ever carries a
          // `payloadJson` key — the per-file `clientImportExtractions`
          // updates never do. Capture just that one for C11's assertions.
          if ("payloadJson" in patch) {
            clientImportsUpdateCalls.push(patch as { payloadJson: unknown });
          }
          return Promise.resolve();
        }),
      })),
    })),
  },
}));

/** Captures every `db.update(clientImports).set(...)` patch, in call order. */
let clientImportsUpdateCalls: Array<{ payloadJson: unknown }> = [];

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
  clientImportsUpdateCalls = [];
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
      filesProcessed: 0,
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

  // C11: the aggregate write at the end of a run is a WHOLESALE
  // `payloadJson` replacement (`{ fileResults, ... }`), not a merge. `chat`
  // (the statement-chat surface's slice, Task 6+) did not exist when that
  // write was first added, so preserving it has to be added explicitly —
  // dropping it silently reverts a chat-surface import to the ordinary
  // wizard the moment extraction re-runs on it.
  describe("C11: preserves payloadJson.chat across the aggregate write", () => {
    const chatSlice = {
      surface: "chat" as const,
      transcript: [],
      decisions: [],
      excludedRows: [],
      committedRowIds: ["r1"],
    };

    it("an import row carrying a chat slice still carries it after extraction", async () => {
      importRowResult = [
        {
          id: "imp1",
          payloadJson: { fileResults: {}, chat: chatSlice },
          extractHoldings: false,
          status: "draft",
        },
      ];
      vi.mocked(extractDocument).mockResolvedValue(
        storedResult("a.pdf", "new") as never,
      );

      await runImportExtraction({
        importId: "imp1",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
      });

      expect(clientImportsUpdateCalls).toHaveLength(1);
      const written = clientImportsUpdateCalls[0].payloadJson as {
        fileResults: Record<string, unknown>;
        chat?: unknown;
      };
      expect(written.chat).toEqual(chatSlice);
      expect(Object.keys(written.fileResults)).toEqual(["f1"]);
    });

    it("an import row with no chat key still persists exactly { fileResults }", async () => {
      importRowResult = [
        { id: "imp1", payloadJson: null, extractHoldings: false, status: "draft" },
      ];
      vi.mocked(extractDocument).mockResolvedValue(
        storedResult("a.pdf", "new") as never,
      );

      await runImportExtraction({
        importId: "imp1",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
      });

      expect(clientImportsUpdateCalls).toHaveLength(1);
      const written = clientImportsUpdateCalls[0].payloadJson as Record<string, unknown>;
      expect(Object.keys(written).sort()).toEqual(["fileResults"]);
    });
  });

  // C12: onFile fires once per file, as it settles, carrying the fields the
  // route needs to stream a `file` SSE event — and never from inside
  // extractOne's own try/catch, so a throwing callback can't mislabel a
  // successful file as failed.
  describe("onFile progress callback (C3/C12)", () => {
    it("reports accountCount and statementDate for a successful file", async () => {
      filesResult = [fileRow("f1", "a.pdf")];
      vi.mocked(extractDocument).mockResolvedValue({
        documentType: "fact_finder",
        fileName: "a.pdf",
        extracted: {
          accounts: [
            { name: "IRA", statementDate: "2026-03-31" },
            { name: "Brokerage" },
          ],
          incomes: [],
          expenses: [],
          liabilities: [],
          entities: [],
          lifePolicies: [],
          wills: [],
        },
        warnings: [],
        promptVersion: "v",
      } as never);

      const events: Array<{ fileName: string; accountCount: number; statementDate?: string; error?: string }> = [];
      await runImportExtraction({
        importId: "imp1",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
        onFile: (p) => events.push(p),
      });

      expect(events).toEqual([
        { fileName: "a.pdf", accountCount: 2, statementDate: "2026-03-31" },
      ]);
    });

    it("reports the failure with fileName + error for a file that throws", async () => {
      filesResult = [fileRow("f1", "corrupt.pdf")];
      vi.mocked(extractDocument).mockRejectedValue(
        new Error("Unsupported PDF encoding"),
      );

      const events: Array<{ fileName: string; accountCount: number; error?: string }> = [];
      const res = await runImportExtraction({
        importId: "imp1",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
        onFile: (p) => events.push(p),
      });

      expect(events).toEqual([
        { fileName: "corrupt.pdf", accountCount: 0, error: "Unsupported PDF encoding" },
      ]);
      // The batch still finishes and still records the failure normally.
      expect(res.failed).toBe(1);
      expect(res.succeeded).toBe(0);
    });

    // Mutation-provable placement check (C12): if onFile were invoked INSIDE
    // extractOne's own try block, a throwing onFile would be caught by the
    // adjacent catch and the file would be recorded as a FAILED extraction
    // even though extractDocument itself succeeded. It must not be.
    it("a throwing onFile does not turn a successful file into a failure", async () => {
      filesResult = [fileRow("f1", "a.pdf")];
      vi.mocked(extractDocument).mockResolvedValue(
        storedResult("a.pdf", "ok") as never,
      );

      const res = await runImportExtraction({
        importId: "imp1",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
        onFile: () => {
          throw new Error("boom from a UI callback");
        },
      });

      expect(res.succeeded).toBe(1);
      expect(res.failed).toBe(0);
    });

    it("fires once per file when multiple files are extracted", async () => {
      filesResult = [fileRow("f1", "a.pdf"), fileRow("f2", "b.pdf")];
      vi.mocked(extractDocument).mockImplementation(async (_buf, fileName) =>
        storedResult(fileName as string, "x") as never,
      );

      const seen: string[] = [];
      await runImportExtraction({
        importId: "imp1",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
        onFile: (p) => seen.push(p.fileName),
      });

      expect(seen.sort()).toEqual(["a.pdf", "b.pdf"]);
    });
  });

  // IMPORTANT 4 (fix round 1, controller ruling): an abandoned tab holds
  // CONCURRENCY (5) Azure slots against a shared per-deployment TPM budget
  // for up to 300s. `signal` is checked ONLY at a chunk boundary and only to
  // `break` — never to throw, and never to cancel an in-flight
  // `Promise.all`, either of which would lose every file that already
  // succeeded (fileResults is written to payloadJson only after the loop).
  describe("signal (C6 third clause, IMPORTANT 4)", () => {
    it("stops starting new concurrency chunks once aborted, but still persists the files that already completed", async () => {
      filesResult = [
        fileRow("f1", "a.pdf"),
        fileRow("f2", "b.pdf"),
        fileRow("f3", "c.pdf"),
        fileRow("f4", "d.pdf"),
        fileRow("f5", "e.pdf"),
        fileRow("f6", "f.pdf"), // 6th file: falls into a SECOND chunk (CONCURRENCY = 5)
      ];
      const ac = new AbortController();
      // Every file in the first chunk aborts as a side effect — simulating
      // the client disconnecting sometime during that chunk. Idempotent, so
      // it doesn't matter which of the 5 concurrent calls "does" it first.
      vi.mocked(extractDocument).mockImplementation(async (_buf, fileName) => {
        ac.abort();
        return storedResult(fileName as string, "x") as never;
      });

      const res = await runImportExtraction({
        importId: "imp1",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
        signal: ac.signal,
      });

      // The 6th file's chunk never started.
      expect(extractDocument).toHaveBeenCalledTimes(5);
      expect(res.succeeded).toBe(5);
      // And the completed chunk's results were NOT discarded — this is the
      // assertion a `break` → `throw` "simplification" would break: a throw
      // here would propagate out of runImportExtraction before the final
      // `db.update` ever runs, leaving clientImportsUpdateCalls empty.
      expect(clientImportsUpdateCalls).toHaveLength(1);
      const written = clientImportsUpdateCalls[0].payloadJson as {
        fileResults: Record<string, unknown>;
      };
      expect(Object.keys(written.fileResults)).toHaveLength(5);
    });

    it("runs every chunk when the signal never aborts", async () => {
      filesResult = [fileRow("f1", "a.pdf"), fileRow("f2", "b.pdf")];
      vi.mocked(extractDocument).mockImplementation(async (_buf, fileName) =>
        storedResult(fileName as string, "x") as never,
      );
      const ac = new AbortController();

      const res = await runImportExtraction({
        importId: "imp1",
        clientId: "c1",
        firmId: "org_A",
        model: "mini",
        extractHoldings: false,
        signal: ac.signal,
      });

      expect(res.succeeded).toBe(2);
    });
  });
});
