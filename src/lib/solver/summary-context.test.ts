// src/lib/solver/summary-context.test.ts
import { describe, it, expect } from "vitest";
import { buildSolverSummaryContext } from "./summary-context";
import type { ProjectionYear } from "@/engine";

const years = [{ year: 2025 }, { year: 2026 }] as unknown as ProjectionYear[];
const clientData = { client: { firstName: "Ada" } } as never;

describe("buildSolverSummaryContext", () => {
  it("maps live solver state into a BuildDataContext", () => {
    const ctx = buildSolverSummaryContext({
      years,
      clientData,
      clientName: "Ada Byron",
      spouseName: "Charles",
      mcSuccessRate: 0.92,
    });
    expect(ctx.years).toBe(years);
    expect(ctx.clientData).toBe(clientData);
    expect(ctx.clientName).toBe("Ada Byron");
    expect(ctx.spouseName).toBe("Charles");
    expect(ctx.scenarioLabel).toBe("Proposed");
    // branding stubbed — builders never read these
    expect(ctx.firmName).toBe("");
    expect(ctx.firmLogoDataUrl).toBeNull();
  });

  it("wraps the MC scalar so retirement reads summary.successRate", () => {
    const ctx = buildSolverSummaryContext({
      years, clientData, clientName: "Ada", spouseName: null, mcSuccessRate: 0.81,
    });
    expect(ctx.monteCarlo?.summary.successRate).toBe(0.81);
  });

  it("null MC scalar => monteCarlo is null", () => {
    const ctx = buildSolverSummaryContext({
      years, clientData, clientName: "Ada", spouseName: null, mcSuccessRate: null,
    });
    expect(ctx.monteCarlo).toBeNull();
  });

  it("passes a supplied full projection through; otherwise stubs from years", () => {
    const full = { years, giftLedger: [], todayHypotheticalEstateTax: {} } as never;
    const withFull = buildSolverSummaryContext({
      years, clientData, clientName: "A", spouseName: null, mcSuccessRate: null, fullProjection: full,
    });
    expect(withFull.projection).toBe(full);
    const withoutFull = buildSolverSummaryContext({
      years, clientData, clientName: "A", spouseName: null, mcSuccessRate: null,
    });
    expect(withoutFull.projection.years).toBe(years);
  });

  it("passes a supplied life-insurance inventory through", () => {
    const inv = { policies: [] };
    const ctx = buildSolverSummaryContext({
      years, clientData, clientName: "A", spouseName: null, mcSuccessRate: null, lifeInsurance: inv,
    });
    expect(ctx.lifeInsurance).toBe(inv);
  });
});
