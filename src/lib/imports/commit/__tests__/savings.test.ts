import { describe, expect, it } from "vitest";
import { emptyImportPayload, type ImportPayload } from "../../types";
import { commitSavings } from "../savings";
import type { CommitContext } from "../types";

const CTX: CommitContext = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
  milestones: {
    planStart: 2026, planEnd: 2082,
    clientRetirement: 2051, clientEnd: 2082,
    spouseRetirement: 2049, spouseEnd: 2084,
  },
};

/** Minimal tx double: records inserts, resolves account-name lookups. */
function fakeTx(accounts: Array<{ id: string; name: string }>) {
  const inserted: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v); } }),
    select: () => ({
      from: () => ({ where: async () => accounts.map((a) => ({ id: a.id, name: a.name })) }),
    }),
  };
  return { tx: tx as never, inserted };
}

function payloadWith(savings: ImportPayload["savings"]): ImportPayload {
  return { ...emptyImportPayload(), savings };
}

describe("commitSavings", () => {
  it("writes a percent-of-salary rule ending at the owner's retirement", async () => {
    const { tx, inserted } = fakeTx([{ id: "acct-1", name: "Zach 401(k)" }]);
    const result = await commitSavings(
      tx,
      payloadWith([
        {
          name: "Zach 401(k): Pre-Tax Contribution",
          destinationAccountName: "Zach 401(k)",
          owner: "client",
          annualPercent: 0.1,
          contributionRole: "employee",
          match: { kind: "new" },
        },
      ]),
      CTX,
    );
    expect(result.created).toBe(1);
    expect(inserted[0]).toMatchObject({
      accountId: "acct-1",
      annualPercent: "0.1",
      endYearRef: "client_retirement",
      // client_retirement (2051) is a TRANSITION ref — the milestone year is
      // the FIRST year of retirement, so the last working (contributing)
      // year is 2050. Matches resolveMilestone's documented semantics and
      // every other call site resolving this same ref/position pair (e.g.
      // quick-start/derive.ts's savingsPayload, savings-rule-dialog.tsx).
      endYear: 2050,
    });
  });

  it("merges the employee and employer rows for one destination", async () => {
    const { tx, inserted } = fakeTx([{ id: "acct-1", name: "Zach 401(k)" }]);
    const result = await commitSavings(
      tx,
      payloadWith([
        { name: "Pre-Tax", destinationAccountName: "Zach 401(k)", owner: "client", annualPercent: 0.1, contributionRole: "employee", match: { kind: "new" } },
        { name: "Employer", destinationAccountName: "Zach 401(k)", owner: "client", employerMatchPct: 1, employerMatchCap: 0.04, contributionRole: "employer", match: { kind: "new" } },
      ]),
      CTX,
    );
    expect(result.created).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      annualPercent: "0.1",
      employerMatchPct: "1",
      employerMatchCap: "0.04",
    });
  });

  it("ends a spouse rule at the spouse's retirement", async () => {
    const { tx, inserted } = fakeTx([{ id: "acct-2", name: "Mariah 403(b)" }]);
    await commitSavings(
      tx,
      payloadWith([
        { name: "Pre-Tax", destinationAccountName: "Mariah 403(b)", owner: "spouse", annualPercent: 0.07, contributionRole: "employee", match: { kind: "new" } },
      ]),
      CTX,
    );
    // spouse_retirement (2049) is a TRANSITION ref too — last contributing
    // year is 2048 (see the note on the client-owned test above).
    expect(inserted[0]).toMatchObject({ endYearRef: "spouse_retirement", endYear: 2048 });
  });

  it("skips a row whose destination account does not exist", async () => {
    const { tx, inserted } = fakeTx([]);
    const result = await commitSavings(
      tx,
      payloadWith([
        { name: "Orphan", destinationAccountName: "Nowhere", annualPercent: 0.05, match: { kind: "new" } },
      ]),
      CTX,
    );
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(result.warnings[0]).toContain("Nowhere");
  });

  it("resolves the destination via the normalized-name fallback when it differs by case/punctuation/spacing", async () => {
    const { tx, inserted } = fakeTx([{ id: "acct-4", name: "401(k) - Fidelity" }]);
    const result = await commitSavings(
      tx,
      payloadWith([
        { name: "Pre-Tax", destinationAccountName: "401k fidelity", owner: "client", annualPercent: 0.06, contributionRole: "employee", match: { kind: "new" } },
      ]),
      CTX,
    );
    expect(result.created).toBe(1);
    expect(inserted[0]).toMatchObject({ accountId: "acct-4" });
  });

  it("warns when a row has a blank destination account", async () => {
    const { tx, inserted } = fakeTx([]);
    const result = await commitSavings(
      tx,
      payloadWith([
        { name: "Mystery Contribution", destinationAccountName: "", annualPercent: 0.05, match: { kind: "new" } },
      ]),
      CTX,
    );
    expect(result.skipped).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(result.warnings[0]).toContain("Mystery Contribution");
  });

  it("warns when two files report a different value for the same destination, and keeps the first", async () => {
    const { tx } = fakeTx([{ id: "acct-1", name: "Zach 401(k)" }]);
    const result = await commitSavings(
      tx,
      payloadWith([
        { name: "Pre-Tax (File A)", destinationAccountName: "Zach 401(k)", owner: "client", annualAmount: 5000, contributionRole: "employee", match: { kind: "new" } },
        { name: "Pre-Tax (File B)", destinationAccountName: "Zach 401(k)", owner: "client", annualAmount: 8000, contributionRole: "employee", match: { kind: "new" } },
      ]),
      CTX,
    );
    expect(result.warnings.some((w) => w.includes("annualAmount"))).toBe(true);
  });

  it("keeps the first file's value when a second file differs, regardless of warning content", async () => {
    const { tx, inserted } = fakeTx([{ id: "acct-1", name: "Zach 401(k)" }]);
    await commitSavings(
      tx,
      payloadWith([
        { name: "Pre-Tax (File A)", destinationAccountName: "Zach 401(k)", owner: "client", annualAmount: 5000, contributionRole: "employee", match: { kind: "new" } },
        { name: "Pre-Tax (File B)", destinationAccountName: "Zach 401(k)", owner: "client", annualAmount: 8000, contributionRole: "employee", match: { kind: "new" } },
      ]),
      CTX,
    );
    expect(inserted[0]).toMatchObject({ annualAmount: "5000" });
  });

  it("does not warn when two files report the identical value for the same destination", async () => {
    const { tx } = fakeTx([{ id: "acct-1", name: "Zach 401(k)" }]);
    const result = await commitSavings(
      tx,
      payloadWith([
        { name: "Pre-Tax (File A)", destinationAccountName: "Zach 401(k)", owner: "client", annualAmount: 5000, contributionRole: "employee", match: { kind: "new" } },
        { name: "Pre-Tax (File B)", destinationAccountName: "Zach 401(k)", owner: "client", annualAmount: 5000, contributionRole: "employee", match: { kind: "new" } },
      ]),
      CTX,
    );
    expect(result.warnings).toHaveLength(0);
  });

  it("writes a flat annual amount", async () => {
    const { tx, inserted } = fakeTx([{ id: "acct-3", name: "Taxable Investment 1" }]);
    await commitSavings(
      tx,
      payloadWith([
        { name: "Annual Contribution", destinationAccountName: "Taxable Investment 1", owner: "client", annualAmount: 12000, contributionRole: "employee", match: { kind: "new" } },
      ]),
      CTX,
    );
    expect(inserted[0]).toMatchObject({ annualAmount: "12000" });
    expect(inserted[0].annualPercent).toBeNull();
  });
});
