// src/lib/solver/__tests__/summary-context.test.ts
import { describe, it, expect } from "vitest";
import { buildSolverSummaryContext } from "../summary-context";
import type { ClientData, ProjectionYear } from "@/engine";

const cd = (tag: string): ClientData => ({ tag } as unknown as ClientData);
const yr = (year: number): ProjectionYear => ({ year } as unknown as ProjectionYear);

describe("buildSolverSummaryContext — bundlesByRef", () => {
  const baseArgs = {
    years: [yr(2025)],
    clientData: cd("working"),
    clientName: "Jane",
    spouseName: null,
    mcSuccessRate: null,
  };

  it("omits bundlesByRef when base data is absent", () => {
    const ctx = buildSolverSummaryContext(baseArgs);
    expect(ctx.bundlesByRef).toBeUndefined();
  });

  it("assembles base + working bundles when base data is present", () => {
    const baseProjection = [yr(2025), yr(2026)];
    const baseClientData = cd("base");
    const ctx = buildSolverSummaryContext({ ...baseArgs, baseClientData, baseProjection });
    expect(Object.keys(ctx.bundlesByRef ?? {}).sort()).toEqual(["base", "scenario:working"]);
    expect(ctx.bundlesByRef!["base"].projection.years).toBe(baseProjection);
    expect(ctx.bundlesByRef!["base"].clientData).toBe(baseClientData);
    expect(ctx.bundlesByRef!["scenario:working"].projection.years).toBe(baseArgs.years);
    expect(ctx.bundlesByRef!["scenario:working"].clientData).toBe(baseArgs.clientData);
  });
});
