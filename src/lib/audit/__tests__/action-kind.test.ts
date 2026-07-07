import { describe, it, expect } from "vitest";
import { actionVerb, deriveActionKind } from "../action-kind";

describe("actionVerb", () => {
  it("returns the last dot-segment", () => {
    expect(actionVerb("income.create")).toBe("create");
    expect(actionVerb("account.holding.override.update")).toBe("update");
    expect(actionVerb("crm.household.soft_delete")).toBe("soft_delete");
  });

  it("returns the whole string when there is no dot", () => {
    expect(actionVerb("noverb")).toBe("noverb");
  });
});

describe("deriveActionKind", () => {
  it("classifies create actions", () => {
    for (const a of [
      "income.create",
      "account.holding.create",
      "crm.task.create",
      "family_member.create",
    ]) {
      expect(deriveActionKind(a)).toBe("create");
    }
  });

  it("classifies update actions (incl. upsert / replace)", () => {
    expect(deriveActionKind("income.update")).toBe("update");
    expect(deriveActionKind("medicare_coverage.upsert")).toBe("update");
    expect(deriveActionKind("account_flow_overrides.replace")).toBe("update");
  });

  it("classifies delete actions (incl. soft/hard delete)", () => {
    expect(deriveActionKind("income.delete")).toBe("delete");
    expect(deriveActionKind("crm.household.soft_delete")).toBe("delete");
    expect(deriveActionKind("client.hard_delete")).toBe("delete");
  });

  it("classifies everything else as other", () => {
    for (const a of [
      "open_item.complete",
      "crm.household.restore",
      "presentations.export_pdf",
      "forge.tool_call",
      "scenario.promote_to_base",
      "crm.task.status_changed",
    ]) {
      expect(deriveActionKind(a)).toBe("other");
    }
  });
});
