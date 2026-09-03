import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectionResult, ClientData } from "@/engine";

// Mock the estate composition deps so the test exercises the helper's own
// wiring (asOf "split", primaryFirst, null-guards) without a full projection
// fixture. Correctness of the underlying report/summarize is covered by the
// estate-summary test suite.
const buildEstateTransferReportData = vi.fn();
const summarizeHousehold = vi.fn();
vi.mock("@/lib/estate/transfer-report", () => ({
  buildEstateTransferReportData: (...args: unknown[]) =>
    buildEstateTransferReportData(...args),
}));
vi.mock("@/lib/presentations/pages/estate-summary/aggregate", () => ({
  summarizeHousehold: (...args: unknown[]) => summarizeHousehold(...args),
}));

import { estateHeirTotalsEol, netToHeirsEol } from "../solver-summary-metrics";

const clientData = { client: { firstName: "Frank" } } as unknown as ClientData;
const ownerNames = { clientName: "Frank", spouseName: "Anita" };
const projection = { years: [{ year: 2026 }] } as unknown as ProjectionResult;

describe("netToHeirsEol", () => {
  beforeEach(() => {
    buildEstateTransferReportData.mockReset();
    summarizeHousehold.mockReset();
  });

  it("returns null when the projection is missing (no death events fetched)", () => {
    expect(netToHeirsEol(undefined, clientData, ownerNames)).toBeNull();
    expect(buildEstateTransferReportData).not.toHaveBeenCalled();
  });

  it("returns null when the estate report is empty", () => {
    buildEstateTransferReportData.mockReturnValue({ isEmpty: true });
    expect(netToHeirsEol(projection, clientData, ownerNames)).toBeNull();
    expect(summarizeHousehold).not.toHaveBeenCalled();
  });

  it("builds the end-of-life (split) report and returns the household net to heirs", () => {
    buildEstateTransferReportData.mockReturnValue({ isEmpty: false });
    summarizeHousehold.mockReturnValue({ netToHeirs: 2_400_000 });

    expect(netToHeirsEol(projection, clientData, ownerNames)).toBe(2_400_000);
    expect(buildEstateTransferReportData).toHaveBeenCalledWith({
      projection,
      asOf: { kind: "split" },
      ordering: "primaryFirst",
      clientData,
      ownerNames,
    });
  });
});

describe("estateHeirTotalsEol", () => {
  beforeEach(() => {
    buildEstateTransferReportData.mockReset();
    summarizeHousehold.mockReset();
  });

  it("returns the heirs' own income tax alongside what reaches them", () => {
    buildEstateTransferReportData.mockReturnValue({ isEmpty: false });
    summarizeHousehold.mockReturnValue({ netToHeirs: 2_400_000, ird: 410_000 });

    expect(estateHeirTotalsEol(projection, clientData, ownerNames))
      .toEqual({ netToHeirs: 2_400_000, heirIncomeTax: 410_000 });
    // …from ONE build. The report is a multi-query, whole-projection compose;
    // the whole point of returning the pair is that a caller wanting both no
    // longer has to run it twice.
    expect(buildEstateTransferReportData).toHaveBeenCalledTimes(1);
  });

  it("returns null on the same two paths netToHeirsEol does", () => {
    expect(estateHeirTotalsEol(undefined, clientData, ownerNames)).toBeNull();
    buildEstateTransferReportData.mockReturnValue({ isEmpty: true });
    expect(estateHeirTotalsEol(projection, clientData, ownerNames)).toBeNull();
  });
});
