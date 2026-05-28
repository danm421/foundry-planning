import { describe, it, expect } from "vitest";
import { detectTrustFundingEvents } from "../../detectors/trust-funding";
import { runProjection } from "@/engine";
import type { ProjectionYear } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

function mkTrustRow(transfersIn: number) {
  return {
    kind: "trust" as const,
    beginningBalance: 0,
    transfersIn,
    growth: 0,
    income: 0,
    totalDistributions: 0,
    expenses: 0,
    taxes: 0,
    endingBalance: transfersIn,
  };
}

function mkProjectionWithEntityCashFlow(years: number, trustId: string, firstYearTransfersIn: number): ProjectionYear[] {
  const startYear = 2030;
  return Array.from({ length: years }).map((_, i) => {
    const cashFlow = new Map<string, ReturnType<typeof mkTrustRow>>();
    if (i === 0) cashFlow.set(trustId, mkTrustRow(firstYearTransfersIn));
    return { year: startYear + i, entityCashFlow: cashFlow } as unknown as ProjectionYear;
  });
}

describe("detectTrustFundingEvents", () => {
  it("emits a per-year per-trust funding card from gifts to a trust", () => {
    const data = buildClientData();
    data.entities = [
      { id: "ent-ilit", name: "Cooper ILIT", trustSubType: "ilit", isIrrevocable: true } as any,
    ];
    data.gifts = [
      { id: "g1", year: 2030, amount: 19000, grantor: "client", recipientEntityId: "ent-ilit", useCrummeyPowers: true },
      { id: "g2", year: 2030, amount: 19000, grantor: "spouse", recipientEntityId: "ent-ilit", useCrummeyPowers: true },
      { id: "g3", year: 2031, amount: 40000, grantor: "joint", recipientEntityId: "ent-ilit", useCrummeyPowers: true },
    ];
    const projection = runProjection(data);
    const events = detectTrustFundingEvents(data, projection);
    const e2030 = events.find((e) => e.id === "estate:trust_funding:ent-ilit:2030");
    const e2031 = events.find((e) => e.id === "estate:trust_funding:ent-ilit:2031");
    expect(e2030).toBeDefined();
    expect(e2030!.supportingFigure).toMatch(/\$38,000/);
    expect(e2031).toBeDefined();
    expect(e2031!.supportingFigure).toMatch(/\$40,000/);
  });

  it("emits an initial-funding event when a trust shows activity with no prior gift event", () => {
    const data = buildClientData();
    data.entities = [
      { id: "ent-rev", name: "Revocable Trust", trustSubType: "revocable" } as any,
    ];
    data.gifts = [];
    const projection = mkProjectionWithEntityCashFlow(5, "ent-rev", 500000);
    const events = detectTrustFundingEvents(data, projection);
    const initial = events.find((e) => e.id === "estate:trust_funding:ent-rev:initial");
    expect(initial).toBeDefined();
    expect(initial!.category).toBe("estate");
    expect(initial!.details.some((d) => d.value.toLowerCase().includes("account ownership"))).toBe(true);
  });

  it("suppresses initial-funding when gift-based funding already exists at or before first activity year", () => {
    const data = buildClientData();
    data.entities = [
      { id: "ent-idgt", name: "IDGT", trustSubType: "idgt", isIrrevocable: true } as any,
    ];
    data.gifts = [
      { id: "g1", year: 2030, amount: 100000, grantor: "client", recipientEntityId: "ent-idgt", useCrummeyPowers: false },
    ];
    const projection = mkProjectionWithEntityCashFlow(5, "ent-idgt", 100000);
    const events = detectTrustFundingEvents(data, projection);
    expect(events.find((e) => e.id === "estate:trust_funding:ent-idgt:initial")).toBeUndefined();
    expect(events.find((e) => e.id === "estate:trust_funding:ent-idgt:2030")).toBeDefined();
  });
});
