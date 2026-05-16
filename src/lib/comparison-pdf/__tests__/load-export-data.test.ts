import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadComparison: vi.fn(),
  buildComparisonPlans: vi.fn(),
  loadProjectionForRef: vi.fn(),
  resolveBranding: vi.fn(),
  clientByIdInFirm: vi.fn(),
  resolveAdvisorName: vi.fn(),
}));

vi.mock("@/lib/comparison/load-layout", () => ({
  loadComparison: mocks.loadComparison,
}));
vi.mock("@/lib/comparison/build-comparison-plans", () => ({
  buildComparisonPlans: mocks.buildComparisonPlans,
}));
vi.mock("@/lib/scenario/load-projection-for-ref", () => ({
  loadProjectionForRef: mocks.loadProjectionForRef,
}));
vi.mock("../branding", () => ({ resolveBranding: mocks.resolveBranding }));
vi.mock("../client-fetch", () => ({
  clientByIdInFirm: mocks.clientByIdInFirm,
  resolveAdvisorName: mocks.resolveAdvisorName,
}));

describe("loadExportData", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it("returns null when comparison is not found", async () => {
    mocks.clientByIdInFirm.mockResolvedValue({
      id: "c1", firmId: "f1", advisorId: "u1",
      firstName: "John", lastName: "Doe", spouseName: null, spouseLastName: null,
    });
    mocks.loadComparison.mockResolvedValue(null);
    const { loadExportData } = await import("../load-export-data");
    const res = await loadExportData({ clientId: "c1", firmId: "f1", comparisonId: "cmp1" });
    expect(res).toBeNull();
  });

  it("returns null when client is not found", async () => {
    mocks.clientByIdInFirm.mockResolvedValue(null);
    const { loadExportData } = await import("../load-export-data");
    const res = await loadExportData({ clientId: "c1", firmId: "f1", comparisonId: "cmp1" });
    expect(res).toBeNull();
  });

  it("assembles client + comparison + plans + branding + advisor", async () => {
    mocks.clientByIdInFirm.mockResolvedValue({
      id: "c1", firmId: "f1", advisorId: "u1",
      firstName: "John", lastName: "Doe", spouseName: null, spouseLastName: null,
    });
    mocks.loadComparison.mockResolvedValue({
      id: "cmp1",
      name: "Retirement Readiness",
      layout: {
        version: 5,
        title: "Retirement Readiness",
        groups: [
          {
            id: "g1",
            title: "G1",
            cells: [
              {
                id: "c1",
                span: 5,
                widget: { id: "w", kind: "kpi", planIds: ["base"], config: {} },
              },
            ],
          },
        ],
      },
    });
    mocks.buildComparisonPlans.mockResolvedValue([{ id: "base", label: "Base case" }]);
    mocks.resolveBranding.mockResolvedValue({
      primaryColor: "#0066cc", firmName: "Acme", logoDataUrl: null,
    });
    mocks.resolveAdvisorName.mockResolvedValue("Jane Advisor");

    const { loadExportData } = await import("../load-export-data");
    const res = await loadExportData({ clientId: "c1", firmId: "f1", comparisonId: "cmp1" });
    expect(res).not.toBeNull();
    expect(res!.layout.title).toBe("Retirement Readiness");
    expect(res!.client.firstName).toBe("John");
    expect(res!.branding.firmName).toBe("Acme");
    expect(res!.advisorName).toBe("Jane Advisor");
    expect(res!.plans).toHaveLength(1);
  });

  it("dedupes plan tokens across cells before loading", async () => {
    mocks.clientByIdInFirm.mockResolvedValue({
      id: "c1", firmId: "f1", advisorId: "u1",
      firstName: "John", lastName: "Doe", spouseName: null, spouseLastName: null,
    });
    mocks.loadComparison.mockResolvedValue({
      id: "cmp1",
      name: "x",
      layout: {
        version: 5,
        title: "x",
        groups: [
          {
            id: "g1",
            title: "G1",
            cells: [
              { id: "c1", span: 5, widget: { id: "w1", kind: "kpi", planIds: ["base", "sc1"], config: {} } },
              { id: "c2", span: 5, widget: { id: "w2", kind: "kpi", planIds: ["sc1"], config: {} } },
            ],
          },
        ],
      },
    });
    mocks.buildComparisonPlans.mockResolvedValue([
      { id: "base", label: "Base" },
      { id: "sc1", label: "S1" },
    ]);
    mocks.resolveBranding.mockResolvedValue({ primaryColor: "#000", firmName: "x", logoDataUrl: null });
    mocks.resolveAdvisorName.mockResolvedValue("x");

    const { loadExportData } = await import("../load-export-data");
    await loadExportData({ clientId: "c1", firmId: "f1", comparisonId: "cmp1" });

    const call = mocks.buildComparisonPlans.mock.calls[0][0];
    expect(call.refs).toHaveLength(2);
  });
});
