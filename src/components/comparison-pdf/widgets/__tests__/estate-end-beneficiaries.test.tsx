import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import {
  EstateEndBeneficiariesPdf,
  buildBeneficiaryRows,
  __TEST_ONLY__,
} from "../estate-end-beneficiaries";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { RecipientTotal } from "@/lib/estate/transfer-report";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

function mkRecipient(
  args: Partial<RecipientTotal> & { recipientLabel: string; total: number },
): RecipientTotal {
  return {
    key: `${args.recipientKind ?? "family"}|${args.recipientLabel}`,
    recipientLabel: args.recipientLabel,
    recipientKind: args.recipientKind ?? "family",
    fromFirstDeath: args.fromFirstDeath ?? 0,
    fromSecondDeath: args.fromSecondDeath ?? args.total,
    total: args.total,
  };
}

function mkPlan(args: { id?: string; label?: string } = {}): ComparisonPlan {
  return {
    id: args.id ?? "p1",
    label: args.label ?? "A",
    tree: {
      client: {
        firstName: "Avery",
        dateOfBirth: "1975-06-20",
        filingStatus: "married_joint",
        spouseDob: "1979-01-01",
        spouseName: "Blake",
      },
      familyMembers: [],
    },
    result: {
      years: [],
    },
  } as unknown as ComparisonPlan;
}

describe("buildBeneficiaryRows (pure helper)", () => {
  it("renders beneficiary names + amounts", () => {
    const rows = buildBeneficiaryRows([
      mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
      mkRecipient({ recipientLabel: "Charity", total: 100_000, recipientKind: "charity" }),
    ]);
    expect(rows.map((r) => r.beneficiary)).toEqual(["Kids", "Charity"]);
    expect(rows.map((r) => r.amount)).toEqual(["$400,000", "$100,000"]);
  });

  it("renders share column as percentage with 1 decimal", () => {
    const rows = buildBeneficiaryRows([
      mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
      mkRecipient({ recipientLabel: "Charity", total: 100_000, recipientKind: "charity" }),
    ]);
    expect(rows.map((r) => r.share)).toEqual(["80.0%", "20.0%"]);
  });

  it("sorts rows by amount descending", () => {
    const rows = buildBeneficiaryRows([
      mkRecipient({ recipientLabel: "Charity", total: 100_000, recipientKind: "charity" }),
      mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
      mkRecipient({ recipientLabel: "Sibling", total: 250_000 }),
    ]);
    expect(rows.map((r) => r.beneficiary)).toEqual(["Kids", "Sibling", "Charity"]);
  });

  it("filters out spouse recipients", () => {
    const rows = buildBeneficiaryRows([
      mkRecipient({
        recipientLabel: "Blake (spouse)",
        total: 500_000,
        recipientKind: "spouse",
      }),
      mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
    ]);
    expect(rows.map((r) => r.beneficiary)).not.toContain("Blake (spouse)");
    expect(rows).toHaveLength(1);
  });

  it("returns an empty array when no recipients", () => {
    expect(buildBeneficiaryRows([])).toEqual([]);
  });

  it("shows '—' for share when denominator is zero", () => {
    const rows = buildBeneficiaryRows([
      mkRecipient({ recipientLabel: "Nobody", total: 0 }),
    ]);
    expect(rows[0].share).toBe("—");
  });

  it("builds total row summing amounts and reporting 100.0%", () => {
    const totals = __TEST_ONLY__.buildTotalRow([
      mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
      mkRecipient({ recipientLabel: "Charity", total: 100_000, recipientKind: "charity" }),
    ]);
    expect(totals).not.toBeNull();
    expect(totals?.beneficiary).toBe("Total");
    expect(totals?.amount).toBe("$500,000");
    expect(totals?.share).toBe("100.0%");
  });

  it("total row is null when denominator is zero", () => {
    const totals = __TEST_ONLY__.buildTotalRow([
      mkRecipient({ recipientLabel: "Nobody", total: 0 }),
    ]);
    expect(totals).toBeNull();
  });
});

describe("EstateEndBeneficiariesPdf (widget integration)", () => {
  // The widget calls buildEstateTransferReportData() which requires a full
  // projection. The integration smoke tests below mirror plan + screen state
  // via small fixtures and verify the empty / multi-plan behavior; the
  // table-rendering logic is covered by the pure-helper tests above.

  it("renders empty-state message when no beneficiary data is available", () => {
    const plan = mkPlan();
    const tree = renderToTree(
      <EstateEndBeneficiariesPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("No beneficiary data available.");
    expect(tree).not.toContain("Total");
  });

  it("renders Beneficiary, Share, and Amount column headers", () => {
    const tree = renderToTree(
      <EstateEndBeneficiariesPdf
        config={undefined}
        plans={[
          {
            ...mkPlan(),
            // Stash recipients on a hidden test-only override the widget
            // can read instead of running buildEstateTransferReportData().
            __testRecipients: [
              mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
              mkRecipient({
                recipientLabel: "Charity",
                total: 100_000,
                recipientKind: "charity",
              }),
            ],
          } as unknown as ComparisonPlan,
        ]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Beneficiary");
    expect(tree).toContain("Share");
    expect(tree).toContain("Amount");
  });

  it("renders beneficiary rows and the Total row with the injected recipients", () => {
    const plan = {
      ...mkPlan(),
      __testRecipients: [
        mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
        mkRecipient({
          recipientLabel: "Charity",
          total: 100_000,
          recipientKind: "charity",
        }),
      ],
    } as unknown as ComparisonPlan;
    const tree = renderToTree(
      <EstateEndBeneficiariesPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Kids");
    expect(tree).toContain("Charity");
    expect(tree).toContain("$400,000");
    expect(tree).toContain("$100,000");
    expect(tree).toContain("80.0%");
    expect(tree).toContain("20.0%");
    // Total row
    expect(tree).toContain("Total");
    expect(tree).toContain("$500,000");
    expect(tree).toContain("100.0%");
    // Sort order: Kids appears before Charity in the rendered string.
    const kidsIdx = tree.indexOf("Kids");
    const charityIdx = tree.indexOf("Charity");
    expect(kidsIdx).toBeGreaterThan(-1);
    expect(charityIdx).toBeGreaterThan(-1);
    expect(kidsIdx).toBeLessThan(charityIdx);
  });

  it("filters out spouse recipients in the rendered widget", () => {
    const plan = {
      ...mkPlan(),
      __testRecipients: [
        mkRecipient({
          recipientLabel: "Blake-Spouse",
          total: 500_000,
          recipientKind: "spouse",
        }),
        mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
      ],
    } as unknown as ComparisonPlan;
    const tree = renderToTree(
      <EstateEndBeneficiariesPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).not.toContain("Blake-Spouse");
    expect(tree).toContain("Kids");
  });

  it("shows plan labels for multi-plan and suppresses them for single-plan", () => {
    const planA = {
      ...mkPlan({ id: "A", label: "Plan Alpha" }),
      __testRecipients: [mkRecipient({ recipientLabel: "Kids", total: 100_000 })],
    } as unknown as ComparisonPlan;
    const planB = {
      ...mkPlan({ id: "B", label: "Plan Beta" }),
      __testRecipients: [mkRecipient({ recipientLabel: "Kids", total: 200_000 })],
    } as unknown as ComparisonPlan;

    const multi = renderToTree(
      <EstateEndBeneficiariesPdf
        config={undefined}
        plans={[planA, planB]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(multi).toContain("Plan Alpha");
    expect(multi).toContain("Plan Beta");

    const single = renderToTree(
      <EstateEndBeneficiariesPdf
        config={undefined}
        plans={[planA]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(single).not.toContain("Plan Alpha");
  });
});
