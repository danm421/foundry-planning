import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tax-returns/documents-store", () => ({
  listDocuments: vi.fn(),
  getState: vi.fn(),
  putOverrides: vi.fn(),
  rowToMergeDocument: vi.fn((r: { id: string; role: string; taxYear: number; extractedFacts: unknown }) => ({
    id: r.id, role: r.role, taxYear: r.taxYear, facts: r.extractedFacts,
  })),
}));
vi.mock("@/lib/tax-returns/recompute", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-returns/recompute")>(
    "@/lib/tax-returns/recompute",
  );
  return { ...actual, recomputeFacts: vi.fn() };
});
vi.mock("@/lib/tax-returns/store", () => ({
  getTaxReturn: vi.fn(),
  updateFacts: vi.fn(),
  setStatus: vi.fn(),
}));

import { listDocuments, getState, putOverrides } from "@/lib/tax-returns/documents-store";
import { recomputeFacts } from "@/lib/tax-returns/recompute";
import { getTaxReturn, updateFacts, setStatus } from "@/lib/tax-returns/store";
import { EmptyRecomputeError } from "@/lib/tax-returns/errors";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { saveReviewedFacts } from "../save-facts";

/** Postgres undefined_table, shaped the way Drizzle actually rejects with it —
 *  nested under `.cause`, not a flat `.code` (see `pg-errors.ts`). */
function undefinedTableError() {
  const pgError = Object.assign(new Error('relation "tax_return_state" does not exist'), {
    code: "42P01",
  });
  return Object.assign(new Error("Failed query: select ..."), { cause: pgError });
}

const RETURN_ID = "33333333-3333-3333-3333-333333333333";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

function docRow(facts: unknown) {
  return { id: "doc-1", role: "full_return", taxYear: 2024, extractedFacts: facts };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTaxReturn).mockResolvedValue({ id: RETURN_ID, taxYear: 2024, status: "needs_review" } as never);
  vi.mocked(recomputeFacts).mockResolvedValue(emptyTaxReturnFacts(2024));
  vi.mocked(setStatus).mockResolvedValue({ taxYear: 2024, status: "ready" } as never);
});

describe("saveReviewedFacts", () => {
  it("persists ONLY the fields the advisor changed, not the whole facts object", async () => {
    const extracted = emptyTaxReturnFacts(2024);
    extracted.income.wages = 100_000;
    extracted.income.agi = 95_000;
    vi.mocked(listDocuments).mockResolvedValue([docRow(extracted)] as never);
    vi.mocked(getState).mockResolvedValue({ taxReturnId: RETURN_ID, factsOverrides: {} } as never);

    const submitted = structuredClone(extracted);
    submitted.income.wages = 101_500; // the only edit

    await saveReviewedFacts({ clientId: CLIENT_ID, taxYear: 2024, submitted });

    expect(putOverrides).toHaveBeenCalledWith(RETURN_ID, { "income.wages": 101_500 });
    expect(recomputeFacts).toHaveBeenCalledWith(RETURN_ID, 2024);
    expect(updateFacts).not.toHaveBeenCalled();
  });

  it("falls back to a direct facts write when the return has no state row", async () => {
    vi.mocked(listDocuments).mockResolvedValue([] as never);
    vi.mocked(getState).mockResolvedValue(null);
    vi.mocked(updateFacts).mockResolvedValue({ taxYear: 2024, status: "needs_review" } as never);

    const submitted = emptyTaxReturnFacts(2024);
    submitted.income.wages = 42_000;

    await saveReviewedFacts({ clientId: CLIENT_ID, taxYear: 2024, submitted });

    expect(updateFacts).toHaveBeenCalledWith(CLIENT_ID, 2024, submitted, undefined);
    expect(putOverrides).not.toHaveBeenCalled();
    expect(recomputeFacts).not.toHaveBeenCalled();
  });

  it("falls back to a direct facts write when tax_return_state is not migrated yet (42P01)", async () => {
    vi.mocked(getState).mockRejectedValue(undefinedTableError());
    vi.mocked(updateFacts).mockResolvedValue({ taxYear: 2024, status: "needs_review" } as never);

    const submitted = emptyTaxReturnFacts(2024);
    submitted.income.wages = 42_000;

    await saveReviewedFacts({ clientId: CLIENT_ID, taxYear: 2024, submitted });

    // If the tables don't exist, no state row and no overrides exist anywhere —
    // the direct write loses nothing. Same fallback as "no state row".
    expect(updateFacts).toHaveBeenCalledWith(CLIENT_ID, 2024, submitted, undefined);
    expect(putOverrides).not.toHaveBeenCalled();
    expect(recomputeFacts).not.toHaveBeenCalled();
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it("rethrows a getState failure that is not an undefined-table error", async () => {
    vi.mocked(getState).mockRejectedValue(new Error("connection terminated"));

    await expect(
      saveReviewedFacts({ clientId: CLIENT_ID, taxYear: 2024, submitted: emptyTaxReturnFacts(2024) }),
    ).rejects.toThrow("connection terminated");
    expect(updateFacts).not.toHaveBeenCalled();
  });

  it("refuses to write empty overrides for a document-less return rather than blanking it", async () => {
    // The exact shape `planBackfill` leaves for a manually-entered row: a
    // state row, zero documents, all of the return's data living in overrides.
    vi.mocked(listDocuments).mockResolvedValue([] as never);
    vi.mocked(getState).mockResolvedValue({
      taxReturnId: RETURN_ID,
      factsOverrides: { "income.wages": 50_000 },
    } as never);

    // The advisor clears every field. Diffed against the (empty, since there
    // are no documents) base, this submission produces zero overrides — the
    // exact write that would silently erase the stored data before
    // recomputeFacts ever gets a chance to refuse.
    const submitted = emptyTaxReturnFacts(2024);

    await expect(
      saveReviewedFacts({ clientId: CLIENT_ID, taxYear: 2024, submitted }),
    ).rejects.toThrow(EmptyRecomputeError);

    expect(putOverrides).not.toHaveBeenCalled();
    expect(recomputeFacts).not.toHaveBeenCalled();
  });

  it("applies the status transition after recomputing, not instead of it", async () => {
    vi.mocked(listDocuments).mockResolvedValue([docRow(emptyTaxReturnFacts(2024))] as never);
    vi.mocked(getState).mockResolvedValue({ taxReturnId: RETURN_ID, factsOverrides: {} } as never);

    await saveReviewedFacts({
      clientId: CLIENT_ID, taxYear: 2024,
      submitted: emptyTaxReturnFacts(2024), nextStatus: "ready",
    });

    expect(recomputeFacts).toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(CLIENT_ID, 2024, "ready");
    // "after", not just "also" — an implementation that called setStatus
    // before recomputeFacts would pass the two assertions above unchanged.
    expect(vi.mocked(recomputeFacts).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(setStatus).mock.invocationCallOrder[0],
    );
  });

  it("returns null when the year does not exist", async () => {
    vi.mocked(getTaxReturn).mockResolvedValue(null);
    const result = await saveReviewedFacts({
      clientId: CLIENT_ID, taxYear: 2024, submitted: emptyTaxReturnFacts(2024),
    });
    expect(result).toBeNull();
  });
});
