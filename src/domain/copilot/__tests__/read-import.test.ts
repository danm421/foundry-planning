import { describe, it, expect } from "vitest";
import { summarizeImport } from "../tools/read";
import { emptyImportPayload } from "@/lib/imports/types";
import type { ImportPayload } from "@/lib/imports/types";

function payloadWith(): ImportPayload {
  return {
    ...emptyImportPayload(),
    accounts: [
      {
        name: "Fidelity Brokerage",
        custodian: "Fidelity",
        value: 1200000,
        accountNumberLast4: "1234",
        match: { kind: "exact", existingId: "acc_1" },
      } as ImportPayload["accounts"][number],
      {
        name: "New Schwab IRA",
        custodian: "Schwab",
        value: 50000,
        match: { kind: "new" },
      } as ImportPayload["accounts"][number],
      {
        name: "Ambiguous account SSN 123-45-6789",
        custodian: "Vanguard",
        value: 9000,
        match: { kind: "fuzzy", candidates: [{ id: "acc_9", score: 0.8 }] },
      } as ImportPayload["accounts"][number],
    ],
    incomes: [{ match: { kind: "new" } } as ImportPayload["incomes"][number]],
  };
}

describe("summarizeImport", () => {
  it("returns counts, per-kind match totals, and per-account match detail", () => {
    const out = summarizeImport("imp_1", "review", payloadWith()) as {
      found: boolean;
      importId: string;
      counts: Record<string, number>;
      matchTotals: { accounts: { exact: number; fuzzy: number; new: number } };
      accounts: Array<{ match: string; matchedExistingId?: string; name: string | null }>;
    };

    expect(out.found).toBe(true);
    expect(out.importId).toBe("imp_1");
    expect(out.counts.accounts).toBe(3);
    expect(out.counts.incomes).toBe(1);
    expect(out.matchTotals.accounts).toEqual({ exact: 1, fuzzy: 1, new: 1 });
    expect(out.accounts[0].match).toBe("exact");
    expect(out.accounts[0].matchedExistingId).toBe("acc_1");
  });

  it("redacts SSNs from extracted strings", () => {
    const out = summarizeImport("imp_1", "review", payloadWith()) as {
      accounts: Array<{ name: string | null }>;
    };
    expect(out.accounts[2].name).not.toContain("123-45-6789");
  });

  it("reports not-yet-extracted when payload is null", () => {
    const out = summarizeImport("imp_1", "draft", null) as { found: boolean; note: string };
    expect(out.found).toBe(true);
    expect(out.note).toMatch(/not complete/i);
  });
});
