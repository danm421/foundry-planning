import { describe, expect, it, vi } from "vitest";
import { completeAccountHoldings, completeExtractedAccounts } from "../holdings-completion";
import type { ExtractedAccount } from "../types";

// A captured set that materially undershoots the stated value: $20k of $100k.
const undershooting: ExtractedAccount = {
  name: "Test Brokerage",
  value: 100_000,
  holdings: [{ ticker: "AAA", shares: 100, price: 200, marketValue: 20_000 }],
};

function metaReturning(holdings: unknown[], finishReason = "stop") {
  return vi.fn().mockResolvedValue({
    content: JSON.stringify({ holdings }),
    finishReason,
  });
}

describe("completeAccountHoldings", () => {
  it("no-ops when holdings already reconcile", async () => {
    const call = vi.fn();
    const account: ExtractedAccount = {
      name: "X",
      value: 1000,
      holdings: [{ ticker: "Z", shares: 1, price: 1000, marketValue: 1000 }],
    };
    const r = await completeAccountHoldings({ account, documentText: "doc", deps: { callExtraction: call } });
    expect(call).not.toHaveBeenCalled();
    expect(r.reconciled).toBe(true);
    expect(r.recovered).toBe(0);
  });

  it("no-ops when there is no stated value", async () => {
    const call = vi.fn();
    const account: ExtractedAccount = { name: "X", holdings: [{ ticker: "Z", shares: 1, price: 5 }] };
    const r = await completeAccountHoldings({ account, documentText: "doc", deps: { callExtraction: call } });
    expect(call).not.toHaveBeenCalled();
    expect(r.reconciled).toBe(true);
  });

  it("recovers the remaining positions and reconciles", async () => {
    const call = metaReturning([{ ticker: "BBB", shares: 100, price: 800, marketValue: 80_000 }]);
    const r = await completeAccountHoldings({ account: undershooting, documentText: "doc", deps: { callExtraction: call } });
    expect(call).toHaveBeenCalledTimes(1);
    expect(r.recovered).toBe(1);
    expect(r.reconciled).toBe(true);
    expect(r.holdings).toHaveLength(2);
  });

  it("stops when a pass returns nothing new (loop-until-dry) and is unreconciled", async () => {
    const call = metaReturning([]); // no remaining positions
    const r = await completeAccountHoldings({ account: undershooting, documentText: "doc", deps: { callExtraction: call } });
    expect(call).toHaveBeenCalledTimes(1);
    expect(r.recovered).toBe(0);
    expect(r.reconciled).toBe(false);
  });

  it("dedupes already-captured positions returned again", async () => {
    const call = metaReturning([{ ticker: "AAA", shares: 100, price: 200, marketValue: 20_000 }]);
    const r = await completeAccountHoldings({ account: undershooting, documentText: "doc", deps: { callExtraction: call } });
    expect(r.recovered).toBe(0);
    expect(r.holdings).toHaveLength(1);
    expect(r.reconciled).toBe(false);
  });

  it("caps at 3 passes", async () => {
    // Each pass adds a small new position but never reconciles.
    let n = 0;
    const call = vi.fn().mockImplementation(() => {
      n += 1;
      return Promise.resolve({
        content: JSON.stringify({ holdings: [{ name: `BOND-${n}`, shares: 1000, price: 100, marketValue: 1000 }] }),
        finishReason: "stop",
      });
    });
    const r = await completeAccountHoldings({ account: undershooting, documentText: "doc", deps: { callExtraction: call } });
    expect(call).toHaveBeenCalledTimes(3);
    expect(r.passes).toBe(3);
    expect(r.reconciled).toBe(false);
  });

  it("flags token truncation", async () => {
    const call = metaReturning([{ ticker: "BBB", shares: 100, price: 800, marketValue: 80_000 }], "length");
    const r = await completeAccountHoldings({ account: undershooting, documentText: "doc", deps: { callExtraction: call } });
    expect(r.truncatedByTokens).toBe(true);
  });

  it("flags errored (and stays unreconciled) when a continuation pass throws", async () => {
    const call = vi.fn().mockRejectedValue(new Error("azure 429"));
    const r = await completeAccountHoldings({ account: undershooting, documentText: "doc", deps: { callExtraction: call } });
    expect(call).toHaveBeenCalledTimes(1);
    expect(r.errored).toBe(true);
    expect(r.reconciled).toBe(false);
    expect(r.recovered).toBe(0);
  });
});

describe("completeExtractedAccounts", () => {
  it("completes each account and emits warnings", async () => {
    const call = metaReturning([{ ticker: "BBB", shares: 100, price: 800, marketValue: 80_000 }]);
    const { accounts, warnings } = await completeExtractedAccounts(
      [undershooting, { name: "Empty", value: 50 }],
      "doc",
      { callExtraction: call },
    );
    expect(accounts[0].holdings).toHaveLength(2);
    expect(warnings.some((w) => w.includes("recovered"))).toBe(true);
  });

  it("warns the stated value is preserved when an account stays unreconciled", async () => {
    const call = metaReturning([]); // nothing recovered → still undershoots
    const { warnings } = await completeExtractedAccounts([undershooting], "doc", {
      callExtraction: call,
    });
    expect(warnings.some((w) => w.includes("stated value will be preserved"))).toBe(true);
    expect(warnings.some((w) => w.includes("interrupted"))).toBe(false);
  });

  it("warns the response was cut off on token truncation", async () => {
    const call = metaReturning(
      [{ ticker: "BBB", shares: 10, price: 100, marketValue: 1_000 }],
      "length",
    );
    const { warnings } = await completeExtractedAccounts([undershooting], "doc", {
      callExtraction: call,
    });
    expect(warnings.some((w) => w.includes("cut off"))).toBe(true);
  });

  it("warns distinctly when completion is interrupted by an error (not the generic preserved note)", async () => {
    const call = vi.fn().mockRejectedValue(new Error("azure down"));
    const { warnings } = await completeExtractedAccounts([undershooting], "doc", {
      callExtraction: call,
    });
    expect(warnings.some((w) => w.includes("interrupted by an extraction error"))).toBe(true);
    expect(warnings.some((w) => w.includes("holdings still total less than"))).toBe(false);
  });

  it("passes through accounts with no holdings or no value, emitting no warnings", async () => {
    const call = vi.fn();
    const { accounts, warnings } = await completeExtractedAccounts(
      [
        { name: "Empty", value: 50 },
        { name: "NoValue", holdings: [{ ticker: "Z", shares: 1, price: 5 }] },
      ],
      "doc",
      { callExtraction: call },
    );
    expect(call).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(0);
    expect(accounts).toHaveLength(2);
  });
});
