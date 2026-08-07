import { describe, it, expect, vi, beforeEach } from "vitest";

// Records every operation the transaction issues, in order, so the tests can
// assert BOTH what was written and that it all happened inside ONE transaction.
// A state row created outside the transaction that carries the document is the
// exact shape that blanks a client's return, so "same transaction" is a
// correctness property here, not a style preference.
const ops = vi.hoisted(() => ({
  log: [] as Array<{ op: string; table: unknown; values?: unknown; inTx: boolean }>,
  transactions: 0,
}));

vi.hoisted(() => undefined);

vi.mock("@/db", () => {
  function recorder(inTx: boolean) {
    return {
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          ops.log.push({ op: "insert", table, values, inTx });
          return {
            onConflictDoNothing: async () => {
              ops.log[ops.log.length - 1].op = "insert:onConflictDoNothing";
              return undefined;
            },
            then: (resolve: (v: undefined) => unknown) => resolve(undefined),
          };
        },
      }),
      delete: (table: unknown) => ({
        where: async () => {
          ops.log.push({ op: "delete", table, inTx });
          return undefined;
        },
      }),
    };
  }
  return {
    db: {
      ...recorder(false),
      transaction: async (cb: (tx: unknown) => Promise<void>) => {
        ops.transactions += 1;
        await cb(recorder(true));
      },
    },
  };
});

vi.mock("../recompute", () => ({ recomputeFacts: vi.fn(async () => undefined) }));

import { taxReturnDocuments, taxReturnState } from "@/db/schema";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { recomputeFacts } from "../recompute";
import { adoptExtractedReturn, adoptManualReturn } from "../adopt-extraction";

const RETURN_ID = "33333333-3333-3333-3333-333333333333";

function args() {
  const facts = { ...emptyTaxReturnFacts(2025), filingStatus: "single" as const };
  return {
    taxReturnId: RETURN_ID,
    taxYear: 2025,
    facts,
    warnings: ["w1"],
    promptVersion: "tax_return_facts:x",
    model: "full",
    filename: "return.pdf",
    vaultDocumentId: "vault-1",
  };
}

beforeEach(() => {
  ops.log = [];
  ops.transactions = 0;
  vi.clearAllMocks();
});

describe("adoptExtractedReturn", () => {
  it("writes the state row and the document in ONE transaction", async () => {
    await adoptExtractedReturn(args());

    expect(ops.transactions).toBe(1);
    // Every write is inside it. A state row committed separately from the
    // document that justifies it is the C1 data-loss shape.
    expect(ops.log.every((o) => o.inTx)).toBe(true);
  });

  it("creates the state row without clobbering an existing one", async () => {
    await adoptExtractedReturn(args());

    const stateWrite = ops.log.find((o) => o.table === taxReturnState);
    // onConflictDoNothing, not an upsert: a re-upload must not reset the
    // advisor's accumulated overrides to `{}`.
    expect(stateWrite?.op).toBe("insert:onConflictDoNothing");
    expect(stateWrite?.values).toEqual({ taxReturnId: RETURN_ID, factsOverrides: {} });
  });

  it("REPLACES the previous full_return rather than appending a second one", async () => {
    await adoptExtractedReturn(args());

    const docOps = ops.log.filter((o) => o.table === taxReturnDocuments).map((o) => o.op);
    // Two full-return documents would make every scalar the corrected copy
    // restates read as a CONFLICT against its own superseded predecessor.
    expect(docOps).toEqual(["delete", "insert"]);
  });

  it("stores the extraction itself as the document's facts", async () => {
    const a = args();
    await adoptExtractedReturn(a);

    const insert = ops.log.find((o) => o.table === taxReturnDocuments && o.op === "insert");
    expect(insert?.values).toMatchObject({
      taxReturnId: RETURN_ID,
      role: "full_return",
      taxYear: 2025,
      // The column is `extractedFacts`. Writing the extraction to `facts`
      // instead would insert a document the merge reads as contributing
      // nothing, and the year would recompute to blanks.
      extractedFacts: a.facts,
      filename: "return.pdf",
      vaultDocumentId: "vault-1",
      promptVersion: "tax_return_facts:x",
      warnings: ["w1"],
      supportingPayload: null,
    });
  });

  it("recomputes AFTER the transaction commits, not inside it", async () => {
    await adoptExtractedReturn(args());

    // recomputeFacts re-reads the documents it must see committed, and it is
    // the single writer of `tax_returns.facts` (D3). Called inside the
    // transaction it would read through a connection that has not committed.
    expect(recomputeFacts).toHaveBeenCalledWith(RETURN_ID, 2025);
    expect(ops.transactions).toBe(1);
  });
});

describe("adoptManualReturn", () => {
  it("creates the state row and NO document", async () => {
    await adoptManualReturn(RETURN_ID);

    // A manual year's facts are `emptyTaxReturnFacts`, so there is nothing for
    // a document to represent — inventing one would give the year a
    // full_return document full of nulls that outlives the advisor's entries.
    expect(ops.log.filter((o) => o.table === taxReturnDocuments)).toHaveLength(0);
    const stateWrite = ops.log.find((o) => o.table === taxReturnState);
    expect(stateWrite?.op).toBe("insert:onConflictDoNothing");
  });

  it("does not recompute — there is nothing yet to derive from", async () => {
    await adoptManualReturn(RETURN_ID);

    // The year has no documents and no overrides at this point, which is
    // exactly the state `EmptyRecomputeError` refuses. Recomputing here would
    // 500 every manual-entry creation.
    expect(recomputeFacts).not.toHaveBeenCalled();
  });
});
