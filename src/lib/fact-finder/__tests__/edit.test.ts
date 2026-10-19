// src/lib/fact-finder/__tests__/edit.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/fact-finder/persist", () => ({ writeFactFinder: vi.fn(), loadFactFinder: vi.fn() }));
vi.mock("@/lib/fact-finder/relink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fact-finder/relink")>();
  return { ...actual, relinkBaseCase: vi.fn() };
});

import { recordAudit } from "@/lib/audit";
import { editFactFinder } from "../edit";
import type { FFOp } from "../ops";
import { loadFactFinder, writeFactFinder } from "../persist";
import { relinkBaseCase } from "../relink";
import { emptyFactFinderState } from "../state";
import { CLAUDE_FILE_ID, type FactFinderState } from "../types";

const SCOPE = { importId: "i1", clientId: "c1", firmId: "org_1" };

/** The stored fact finder at `version`: one empty cash row. */
function stored(version: number): FactFinderState {
  const s = emptyFactFinderState();
  return { ...s, version, sections: { ...s.sections, cash: [{ id: "r1", cells: {}, sourceFileIds: [] }] } };
}

const setName: FFOp = { op: "setCell", sectionId: "cash", rowId: "r1", columnId: "accountName", value: "Riverside Checking" };
const statement = { sectionId: "cash", rowId: "r1", columnId: "accountName", documentName: "Riverside Bank March 2026.pdf", page: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writeFactFinder).mockImplementation(async (_scope, base, next) => ({ ...next, version: base + 1 }));
  vi.mocked(relinkBaseCase).mockImplementation(async (state) => state);
});

describe("editFactFinder", () => {
  it("applies the ops at the expected version, writes them and audits the edit as the session's actor", async () => {
    const outcome = await editFactFinder(SCOPE, stored(3), 3, [setName], { by: "advisor" });

    expect(writeFactFinder).toHaveBeenCalledOnce();
    const [scope, base, next] = vi.mocked(writeFactFinder).mock.calls[0];
    expect(scope).toEqual(SCOPE);
    expect(base).toBe(3);
    expect(next.sections.cash[0].cells.accountName).toEqual({ value: "Riverside Checking", by: "advisor", pinned: true });
    expect(outcome).toEqual({ ok: true, state: { ...next, version: 4 } });
    expect(recordAudit).toHaveBeenCalledExactlyOnceWith({
      action: "import.payload.edited",
      resourceType: "client_import",
      resourceId: "i1",
      clientId: "c1",
      firmId: "org_1",
      metadata: { surface: "fact_finder", ops: { setCell: 1 }, version: 4 },
    });
    expect(vi.mocked(recordAudit).mock.calls[0][0].actorId).toBeUndefined();
  });

  it("a stale baseVersion gets 409 and the fact finder as it is, with nothing written", async () => {
    const current = stored(3);
    const outcome = await editFactFinder(SCOPE, current, 2, [setName], { by: "advisor" });
    expect(outcome).toEqual({ ok: false, status: 409, error: "conflict", factFinder: current });
    expect(writeFactFinder).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("an op the fact finder refuses gets 400 with its message, with nothing written", async () => {
    const pension: FFOp = { ...setName, columnId: "accountType", value: "Pension" } as FFOp;
    const outcome = await editFactFinder(SCOPE, stored(3), 3, [pension], { by: "advisor" });
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    expect(outcome.ok === false && outcome.error).toMatch(/isn't one of the options for Account type/);
    expect(outcome).not.toHaveProperty("factFinder");
    expect(writeFactFinder).not.toHaveBeenCalled();
  });

  it("a write that lost to another gets 409 and the fresh fact finder, unaudited", async () => {
    vi.mocked(writeFactFinder).mockResolvedValueOnce(null);
    vi.mocked(loadFactFinder).mockResolvedValueOnce(stored(4));
    const outcome = await editFactFinder(SCOPE, stored(3), 3, [setName], { by: "advisor" });
    expect(loadFactFinder).toHaveBeenCalledWith(SCOPE);
    expect(outcome).toEqual({ ok: false, status: 409, error: "conflict", factFinder: stored(4) });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("stamps the cited document on the cells it set, before re-scoring links, and writes that", async () => {
    const rescored = (state: FactFinderState): FactFinderState => ({
      ...state,
      sections: { ...state.sections, cash: state.sections.cash.map((r) => ({ ...r, link: { kind: "new", by: "auto" } })) },
    });
    vi.mocked(relinkBaseCase).mockImplementationOnce(async (state) => rescored(state));
    const outcome = await editFactFinder(SCOPE, stored(3), 3, [setName], { by: "chat", stamps: [statement] });

    const relinked = vi.mocked(relinkBaseCase).mock.calls[0];
    expect(relinked[1]).toBe("c1");
    const cited = { fileId: CLAUDE_FILE_ID, documentName: "Riverside Bank March 2026.pdf", page: 2, snippet: undefined };
    expect(relinked[0].sections.cash[0].cells.accountName).toEqual({ value: "Riverside Checking", by: "chat", pinned: true, source: cited });
    const written = vi.mocked(writeFactFinder).mock.calls[0][2];
    expect(written).toEqual(rescored(relinked[0]));
    expect(outcome.ok && outcome.state.sections.cash[0].cells.accountName.source).toEqual(cited);
  });

  it("re-scores links only after an edit that can change one", async () => {
    const s = stored(3);
    const brokerage = {
      id: "t1",
      cells: {},
      sourceFileIds: [],
      holdings: [{ id: "h1", ticker: "VTI", name: null, shares: 10, price: null, marketValue: null, costBasis: null, by: "document" as const }],
    };
    const withHolding = { ...s, sections: { ...s.sections, taxable: [brokerage] } };
    const shares: FFOp = { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1", field: "shares", value: 12 };
    await editFactFinder(SCOPE, withHolding, 3, [shares], { by: "advisor" });
    expect(relinkBaseCase).not.toHaveBeenCalled();
  });

  it("names the given actor on the audit", async () => {
    await editFactFinder(SCOPE, stored(3), 3, [setName], { by: "chat", actorId: "user_7" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "import.payload.edited", actorId: "user_7" }));
  });
});
