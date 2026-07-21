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
  it("summarizes promote_to_base as DESTRUCTIVE (overwrites base + deletes all other scenarios)", () => {
    const out = formatProposedWrite({ name: "promote_to_base", args: { scenarioId: "s1" } });
    expect(out.name).toBe("promote_to_base");
    expect(out.summary).toContain("s1");
    expect(out.summary).toMatch(/destructive/i);
    expect(out.summary).toMatch(/delete/i);
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

  it("previews create_household without a ctx (global mode)", async () => {
    const out = await describeProposedWrite({
      name: "create_household",
      args: { name: "Doe Household", state: "NJ", primaryContact: { firstName: "Jane", lastName: "Doe" } },
    });
    expect(out.name).toBe("create_household");
    expect(out.summary).toMatch(/Doe Household/);
    expect(out.summary).toMatch(/Jane Doe/);
  });

  it("previews set_up_plan without a ctx (global mode)", async () => {
    const out = await describeProposedWrite({
      name: "set_up_plan",
      args: { householdId: "hh_1", retirementAge: 65, lifeExpectancy: 95, filingStatus: "married_joint", primaryDob: "1970-05-15" },
    });
    expect(out.name).toBe("set_up_plan");
    expect(out.summary).toMatch(/financial plan/i);
    expect(out.summary).toMatch(/retire at 65/);
    expect(out.summary).toMatch(/married_joint/);
  });

  it("previews build_plan (GLOBAL mode, new prospect) with every arg an advisor needs to catch a mishearing", async () => {
    const out = await describeProposedWrite({
      name: "build_plan",
      args: {
        householdName: "Doe Household",
        state: "NJ",
        primaryFirstName: "Jane",
        primaryLastName: "Doe",
        primaryDob: "1970-05-15",
        spouseFirstName: "John",
        spouseLastName: "Doe",
        spouseDob: "1972-02-01",
        filingStatus: "married_joint",
        retirementAge: 65,
        lifeExpectancy: 95,
      },
    });
    expect(out.name).toBe("build_plan");
    expect(out.summary).toMatch(/Doe Household/);
    expect(out.details).toBeDefined();
    const details = out.details!.join(" ");
    expect(details).toMatch(/Jane Doe/);
    expect(details).toMatch(/1970-05-15/);
    expect(details).toMatch(/John Doe/);
    expect(details).toMatch(/1972-02-01/);
    expect(details).toMatch(/NJ/);
    expect(details).toMatch(/married_joint/);
    expect(details).toMatch(/65/);
    expect(details).toMatch(/95/);
  });

  it("previews build_plan (GLOBAL mode, new prospect, no spouse) without a spouse line", async () => {
    const out = await describeProposedWrite({
      name: "build_plan",
      args: {
        householdName: "Solo Household",
        primaryFirstName: "Sam",
        primaryLastName: "Lee",
        primaryDob: "1980-01-01",
        filingStatus: "single",
        retirementAge: 67,
        lifeExpectancy: 90,
      },
    });
    expect(out.name).toBe("build_plan");
    expect(out.summary).toMatch(/Solo Household/);
    expect(out.details!.join(" ")).not.toMatch(/Spouse/);
  });

  it("previews build_plan (CLIENT mode, no args) without rendering undefined", async () => {
    const out = await describeProposedWrite({ name: "build_plan", args: {} });
    expect(out.name).toBe("build_plan");
    expect(out.summary).not.toMatch(/undefined/);
    expect(out.summary.length).toBeGreaterThan(0);
    expect(out.details).toBeUndefined();
  });

  it("previews tasks_create without a ctx (global mode)", async () => {
    const out = await describeProposedWrite({
      name: "tasks_create",
      args: { title: "Call Jane", priority: "high", dueDate: "2026-07-15" },
    });
    expect(out.name).toBe("tasks_create");
    expect(out.summary).toMatch(/Call Jane/);
    expect(out.summary).toMatch(/firm-level/); // no householdId supplied
  });

  it("previews tasks_delete without a ctx (global mode)", async () => {
    const out = await describeProposedWrite({ name: "tasks_delete", args: { taskId: "task_1" } });
    expect(out.name).toBe("tasks_delete");
    expect(out.summary).toMatch(/permanent/i);
  });
});
