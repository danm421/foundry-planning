import { describe, it, expect } from "vitest";
import type {
  DeathSectionData,
  EstateTransferReportData,
  RecipientGroup,
} from "@/lib/estate/transfer-report";
import { buildHeirRows } from "../heirs";

function group(over: Partial<RecipientGroup>): RecipientGroup {
  return {
    key: "family_member|a", recipientKind: "family_member", recipientId: "a",
    recipientLabel: "Emily", total: 0, byMechanism: [],
    drainsByKind: { federal_estate_tax: 0, state_estate_tax: 0, probate: 0, admin_expenses: 0, debts_paid: 0, ird_tax: 0 },
    netTotal: 0, ...over,
  };
}
function section(recipients: RecipientGroup[]): DeathSectionData {
  return {
    decedent: "client", decedentName: "John", year: 2050,
    taxableEstate: 0, grossEstate: 0, assetEstateValue: 0, assetCount: 0,
    recipients, reductions: [], conflicts: [],
    grossEstateDollarsByAccount: {}, grossEstateDollarsByLiability: {},
    reconciliation: { sumLiabilityTransfers: 0, sumRecipients: 0, sumReductions: 0, unattributed: 0, reconciles: true },
  };
}
function report(over: Partial<EstateTransferReportData>): EstateTransferReportData {
  return { ordering: "primaryFirst", asOfLabel: "", firstDeath: null, secondDeath: null, aggregateRecipientTotals: [], isEmpty: false, ...over };
}

describe("buildHeirRows", () => {
  it("splits net by the heir's gross outright/in-trust ratio", () => {
    // Emily: gross 1,000 outright + 1,000 in-trust → 50/50; net = 1,800
    const emilyGross = group({
      key: "family_member|a", recipientLabel: "Emily",
      byMechanism: [
        { mechanism: "will", mechanismLabel: "Specific Bequest", total: 1_000,
          assets: [{ sourceAccountId: "x", sourceLiabilityId: null, label: "Acct", amount: 1_000, basis: 0, conflictIds: [] }] },
        { mechanism: "trust_pour_out", mechanismLabel: "Trust Pour-Out", total: 1_000,
          assets: [{ sourceAccountId: "y", sourceLiabilityId: null, label: "Trust", amount: 1_000, basis: 0, conflictIds: [], distributionForm: "in_trust" }] },
      ],
    });
    const eol = report({
      secondDeath: section([emilyGross]),
      aggregateRecipientTotals: [
        { key: "family_member|a", recipientLabel: "Emily", recipientKind: "family_member", fromFirstDeath: 0, fromSecondDeath: 1_800, total: 1_800 },
      ],
    });
    const today = report({}); // empty
    const rows = buildHeirRows(today, eol);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientLabel: "Emily", todayTotal: 0, eolTotal: 1_800 });
    expect(rows[0].eolInTrust).toBeCloseTo(900);
    expect(rows[0].eolOutright).toBeCloseTo(900);
  });

  it("treats heirs with no gross form lines as fully outright", () => {
    const today = report({
      aggregateRecipientTotals: [
        { key: "external_beneficiary|c", recipientLabel: "Charity", recipientKind: "external_beneficiary", fromFirstDeath: 500, fromSecondDeath: 0, total: 500 },
      ],
      firstDeath: section([]), // no recipient groups → no gross lines
    });
    const rows = buildHeirRows(today, report({}));
    expect(rows[0]).toMatchObject({ todayOutright: 500, todayInTrust: 0 });
  });

  it("sorts by combined total descending and reconciles to net to heirs", () => {
    const eol = report({
      aggregateRecipientTotals: [
        { key: "family_member|a", recipientLabel: "Emily", recipientKind: "family_member", fromFirstDeath: 0, fromSecondDeath: 1_000, total: 1_000 },
        { key: "family_member|b", recipientLabel: "Mark", recipientKind: "family_member", fromFirstDeath: 0, fromSecondDeath: 3_000, total: 3_000 },
      ],
    });
    const rows = buildHeirRows(report({}), eol);
    expect(rows.map((r) => r.recipientLabel)).toEqual(["Mark", "Emily"]);
    expect(rows.reduce((s, r) => s + r.eolTotal, 0)).toBe(4_000);
  });
});
