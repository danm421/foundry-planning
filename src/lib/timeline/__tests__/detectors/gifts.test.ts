import { describe, it, expect } from "vitest";
import { detectGiftEvents } from "../../detectors/gifts";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectGiftEvents", () => {
  it("aggregates multiple gifts in the same year into one card", () => {
    const data = buildClientData();
    data.familyMembers = [
      { id: "fm-kid-1", firstName: "Avery", lastName: null, role: "child", relationship: "child", dateOfBirth: null } as any,
      { id: "fm-kid-2", firstName: "Blake", lastName: null, role: "child", relationship: "child", dateOfBirth: null } as any,
    ];
    data.gifts = [
      { id: "g-1", year: 2030, amount: 19000, grantor: "client", recipientFamilyMemberId: "fm-kid-1", useCrummeyPowers: false },
      { id: "g-2", year: 2030, amount: 19000, grantor: "client", recipientFamilyMemberId: "fm-kid-2", useCrummeyPowers: false },
    ];
    const projection = runProjection(data);
    const events = detectGiftEvents(data, projection);
    const ev = events.find((e) => e.id === "estate:gifts:2030");
    expect(ev).toBeDefined();
    expect(ev!.category).toBe("estate");
    expect(ev!.supportingFigure).toMatch(/\$38,000.*2 recipient/);
    expect(ev!.details.some((d) => d.value.includes("Avery") || d.label.includes("Avery"))).toBe(true);
    expect(ev!.details.some((d) => d.value.includes("Blake") || d.label.includes("Blake"))).toBe(true);
  });

  it("excludes gifts whose recipient is a trust entity", () => {
    const data = buildClientData();
    data.entities = [
      { id: "ent-ilit", name: "Cooper ILIT", trustSubType: "ilit", isIrrevocable: true } as any,
    ];
    data.familyMembers = [
      { id: "fm-kid-1", firstName: "Avery", lastName: null, role: "child", relationship: "child", dateOfBirth: null } as any,
    ];
    data.gifts = [
      { id: "g-cash", year: 2030, amount: 19000, grantor: "client", recipientFamilyMemberId: "fm-kid-1", useCrummeyPowers: false },
      { id: "g-trust", year: 2030, amount: 50000, grantor: "client", recipientEntityId: "ent-ilit", useCrummeyPowers: true },
    ];
    const projection = runProjection(data);
    const events = detectGiftEvents(data, projection);
    const ev = events.find((e) => e.id === "estate:gifts:2030");
    expect(ev).toBeDefined();
    expect(ev!.supportingFigure).toMatch(/\$19,000.*1 recipient/);
  });

  it("adds a Crummey-vs-outright summary row when both kinds appear same year", () => {
    const data = buildClientData();
    data.familyMembers = [
      { id: "fm-a", firstName: "Avery", lastName: null, role: "child", relationship: "child", dateOfBirth: null } as any,
      { id: "fm-b", firstName: "Blake", lastName: null, role: "child", relationship: "child", dateOfBirth: null } as any,
    ];
    data.gifts = [
      { id: "g-out", year: 2030, amount: 19000, grantor: "client", recipientFamilyMemberId: "fm-a", useCrummeyPowers: false },
      { id: "g-crm", year: 2030, amount: 19000, grantor: "spouse", recipientFamilyMemberId: "fm-b", useCrummeyPowers: true },
    ];
    const projection = runProjection(data);
    const events = detectGiftEvents(data, projection);
    const ev = events.find((e) => e.id === "estate:gifts:2030");
    expect(ev).toBeDefined();
    const summary = ev!.details.find((d) => d.label.toLowerCase().includes("crummey"));
    expect(summary).toBeDefined();
  });

  it("emits no event in years with zero non-trust gifts", () => {
    const data = buildClientData();
    data.gifts = [];
    const projection = runProjection(data);
    const events = detectGiftEvents(data, projection);
    expect(events.filter((e) => e.id.startsWith("estate:gifts:"))).toHaveLength(0);
  });
});
