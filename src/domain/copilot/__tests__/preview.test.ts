import { describe, it, expect } from "vitest";
import { formatProposedWrite, describeProposedWrite } from "../preview";
import type { ProposedWrite } from "../preview";

describe("formatProposedWrite (pure)", () => {
  it("summarizes create_scenario with the clone source", () => {
    const call: ProposedWrite = { name: "create_scenario", args: { name: "Roth ladder", copyFrom: "base" } };
    const out = formatProposedWrite(call);
    expect(out.name).toBe("create_scenario");
    expect(out.summary).toMatch(/Create scenario/i);
    expect(out.summary).toContain("Roth ladder");
    expect(out.summary).toMatch(/cloned from Base|from Base/i);
  });
  it("summarizes create_scenario from empty when copyFrom omitted", () => {
    const out = formatProposedWrite({ name: "create_scenario", args: { name: "Blank slate" } });
    expect(out.summary).toContain("Blank slate");
    expect(out.summary).toMatch(/empty|scratch/i);
  });
  it("summarizes propose_changes with per-change describeChangeUnit lines as details", () => {
    const call: ProposedWrite = { name: "propose_changes", args: { scenarioId: "s1", groupName: "Delay SS to 70", changes: [ { opType: "edit", targetKind: "plan_settings", targetId: "plan_settings", desiredFields: { ssClaimAgePrimary: 70 } } ] } };
    const out = formatProposedWrite(call);
    expect(out.summary).toMatch(/1 change|Propose/i);
    expect(out.summary).toContain("Delay SS to 70");
    expect(out.details).toBeDefined();
    expect(out.details!.join(" ")).toMatch(/ssClaimAgePrimary/);
    expect(out.details!.join(" ")).toMatch(/70/);
  });
  it("summarizes propose_changes add/remove with the entity kind", () => {
    const out = formatProposedWrite({ name: "propose_changes", args: { scenarioId: "s1", groupName: "Add a 529", changes: [ { opType: "add", targetKind: "account", targetId: "a-new", entity: { id: "a-new", name: "529 Plan" } }, { opType: "remove", targetKind: "income", targetId: "inc-old" } ] } });
    expect(out.details!.join(" ")).toMatch(/Added/);
    expect(out.details!.join(" ")).toMatch(/Removed/);
  });
  it("summarizes revert_change", () => {
    const out = formatProposedWrite({ name: "revert_change", args: { scenarioId: "s1", targetKind: "income", targetId: "inc1", opType: "edit" } });
    expect(out.summary).toMatch(/Remove proposed change|Revert/i);
    expect(out.summary).toContain("income");
  });
  it("summarizes compare_and_snapshot with both sides", () => {
    const out = formatProposedWrite({ name: "compare_and_snapshot", args: { name: "Base vs Roth", leftRef: "base", rightRef: "s2" } });
    expect(out.summary).toMatch(/snapshot/i);
    expect(out.summary).toContain("Base vs Roth");
  });
  it("falls back gracefully for an unknown tool", () => {
    const out = formatProposedWrite({ name: "mystery", args: { a: 1 } });
    expect(out.summary).toContain("mystery");
  });
});

describe("describeProposedWrite (async wrapper without ctx)", () => {
  it("returns the pure formatter result when no auth context is supplied", async () => {
    const out = await describeProposedWrite({ name: "create_scenario", args: { name: "Roth ladder", copyFrom: "base" } });
    expect(out.summary).toContain("Roth ladder");
  });
});
