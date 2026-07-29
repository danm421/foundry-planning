import { describe, it, expect } from "vitest";
import {
  buildLiabilityBasePayload,
  buildLiabilityScenarioDesiredFields,
} from "../liability-write";
import type { LiabilityRow } from "@/components/balance-sheet-view";

function row(overrides: Partial<LiabilityRow> = {}): LiabilityRow {
  return {
    id: "liab-1",
    name: "Home Mortgage",
    balance: "600000",
    interestRate: "0.04",
    monthlyPayment: "3200",
    startYear: 2020,
    startMonth: 6,
    termMonths: 360,
    termUnit: "annual",
    balanceAsOfMonth: null,
    balanceAsOfYear: null,
    linkedPropertyId: null,
    ownerEntityId: null,
    isInterestDeductible: true,
    linkedSource: null,
    owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
    parentAccountId: null,
    ...overrides,
  } as LiabilityRow;
}

describe("buildLiabilityBasePayload", () => {
  it("sends only the changed keys", () => {
    expect(buildLiabilityBasePayload({ balance: "550000" })).toEqual({ balance: "550000" });
  });
});

describe("buildLiabilityScenarioDesiredFields", () => {
  it("sends the whole row so a narrow edit cannot drop an unrelated override", () => {
    const out = buildLiabilityScenarioDesiredFields(row(), { balance: "550000" });
    expect(out.balance).toBe("550000");
    expect(out.interestRate).toBe("0.04");
    expect(out.monthlyPayment).toBe("3200");
    expect(out.termMonths).toBe(360);
  });

  it("strips id — identity is never data", () => {
    expect(buildLiabilityScenarioDesiredFields(row(), {})).not.toHaveProperty("id");
  });

  it("strips linkedSource — a view-only integration marker", () => {
    const out = buildLiabilityScenarioDesiredFields(row({ linkedSource: "plaid" }), {});
    expect(out).not.toHaveProperty("linkedSource");
  });

  it("strips ownerEntityId — derived from owners by controllingEntity()", () => {
    // net-worth-content.tsx computes it as `controllingEntity(l)`. It exists on
    // neither the engine liability nor its meta, so emitting it would only ever
    // diff as {from: undefined, to: ...} and bloat the payload.
    const out = buildLiabilityScenarioDesiredFields(row({ ownerEntityId: "e1" }), {});
    expect(out).not.toHaveProperty("ownerEntityId");
  });

  it("keeps owners — the persisted relation, not a derived label", () => {
    const out = buildLiabilityScenarioDesiredFields(row(), {});
    expect(out.owners).toEqual([{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
  });

  it("keeps an explicit null — it is a real stored value", () => {
    const out = buildLiabilityScenarioDesiredFields(row({ linkedPropertyId: null }), {});
    expect(out).toHaveProperty("linkedPropertyId", null);
  });

  it("lets the patch override the row", () => {
    const next = [{ kind: "entity" as const, entityId: "e1", percent: 1 }];
    const out = buildLiabilityScenarioDesiredFields(row(), { owners: next });
    expect(out.owners).toEqual(next);
  });
});
