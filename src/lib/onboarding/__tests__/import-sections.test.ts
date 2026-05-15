import { describe, it, expect } from "vitest";
import { emptyImportPayload } from "@/lib/imports/types";
import {
  IMPORT_ELIGIBLE_STEPS,
  isImportEligibleStep,
  STEP_COMMIT_TABS,
  stepHasImportData,
} from "../import-sections";

describe("import-sections", () => {
  it("marks the 7 data-entry steps eligible, others not", () => {
    expect([...IMPORT_ELIGIBLE_STEPS].sort()).toEqual(
      ["accounts", "cash-flow", "entities", "estate", "family", "insurance", "liabilities"].sort(),
    );
    expect(isImportEligibleStep("accounts")).toBe(true);
    expect(isImportEligibleStep("household")).toBe(false);
    expect(isImportEligibleStep("assumptions")).toBe(false);
    expect(isImportEligibleStep("review")).toBe(false);
  });

  it("maps cash-flow to both incomes and expenses commit tabs", () => {
    expect(STEP_COMMIT_TABS["cash-flow"]).toEqual(["incomes", "expenses"]);
    expect(STEP_COMMIT_TABS.family).toEqual(["clients-identity", "family-members"]);
    expect(STEP_COMMIT_TABS.insurance).toEqual(["life-insurance"]);
  });

  it("stepHasImportData is false for an empty payload", () => {
    const p = emptyImportPayload();
    for (const step of IMPORT_ELIGIBLE_STEPS) {
      expect(stepHasImportData(p, step)).toBe(false);
    }
  });

  it("stepHasImportData detects each section", () => {
    const p = emptyImportPayload();
    p.accounts.push({ match: { kind: "new" } } as never);
    expect(stepHasImportData(p, "accounts")).toBe(true);
    expect(stepHasImportData(p, "liabilities")).toBe(false);

    const p2 = emptyImportPayload();
    p2.incomes.push({ match: { kind: "new" } } as never);
    expect(stepHasImportData(p2, "cash-flow")).toBe(true);

    const p3 = emptyImportPayload();
    p3.primary = { match: { kind: "new" } } as never;
    expect(stepHasImportData(p3, "family")).toBe(true);
  });
});
