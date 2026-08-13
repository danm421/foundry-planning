import { describe, it, expect, vi, beforeEach } from "vitest";

const getProposal = vi.fn();
const listProposals = vi.fn();

vi.mock("@/lib/investments/proposals/queries", () => ({
  getProposal: (...args: unknown[]) => getProposal(...args),
  listProposals: (...args: unknown[]) => listProposals(...args),
}));

import {
  loadInvestmentProposalBundle,
  loadProposalPickerOptions,
} from "../investment-proposal-bundle";

const SNAPSHOT = { version: 1, computedAt: "2026-08-12T00:00:00.000Z" };

const ROW = {
  id: "p1",
  name: "Move to the core model",
  targetLabel: "60/40 Core",
  status: "draft" as const,
  result: SNAPSHOT,
  computedAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T01:00:00.000Z"),
};

beforeEach(() => {
  getProposal.mockReset();
  listProposals.mockReset();
});

describe("loadInvestmentProposalBundle", () => {
  it("returns the frozen snapshot with its identifying labels", async () => {
    getProposal.mockResolvedValue(ROW);
    const bundle = await loadInvestmentProposalBundle("c1", "p1");
    expect(bundle).toEqual({
      proposalId: "p1",
      name: "Move to the core model",
      targetLabel: "60/40 Core",
      status: "draft",
      computedAt: "2026-08-12T00:00:00.000Z",
      snapshot: SNAPSHOT,
    });
    expect(getProposal).toHaveBeenCalledWith("c1", "p1");
  });

  it("returns null for a deleted proposal instead of throwing", async () => {
    getProposal.mockResolvedValue(null);
    await expect(loadInvestmentProposalBundle("c1", "gone")).resolves.toBeNull();
  });

  it("returns null for an empty id without touching the DB", async () => {
    await expect(loadInvestmentProposalBundle("c1", "")).resolves.toBeNull();
    expect(getProposal).not.toHaveBeenCalled();
  });
});

describe("loadProposalPickerOptions", () => {
  it("maps rows to picker options in the order the query returned them", async () => {
    listProposals.mockResolvedValue([ROW, { ...ROW, id: "p2", name: "Second" }]);
    await expect(loadProposalPickerOptions("c1")).resolves.toEqual([
      { id: "p1", name: "Move to the core model", targetLabel: "60/40 Core", computedAt: "2026-08-12T00:00:00.000Z" },
      { id: "p2", name: "Second", targetLabel: "60/40 Core", computedAt: "2026-08-12T00:00:00.000Z" },
    ]);
  });
});
