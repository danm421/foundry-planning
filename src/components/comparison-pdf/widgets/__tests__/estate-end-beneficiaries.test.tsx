import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import {
  EstateBeneficiariesBlock,
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
    key: `${args.recipientKind ?? "family_member"}|${args.recipientLabel}`,
    recipientLabel: args.recipientLabel,
    recipientKind: args.recipientKind ?? "family_member",
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
      mkRecipient({ recipientLabel: "Charity", total: 100_000, recipientKind: "external_beneficiary" }),
    ]);
    expect(rows.map((r) => r.beneficiary)).toEqual(["Kids", "Charity"]);
    expect(rows.map((r) => r.amount)).toEqual(["$400,000", "$100,000"]);
  });

  it("renders share column as percentage with 1 decimal", () => {
    const rows = buildBeneficiaryRows([
      mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
      mkRecipient({ recipientLabel: "Charity", total: 100_000, recipientKind: "external_beneficiary" }),
    ]);
    expect(rows.map((r) => r.share)).toEqual(["80.0%", "20.0%"]);
  });

  it("sorts rows by amount descending", () => {
    const rows = buildBeneficiaryRows([
      mkRecipient({ recipientLabel: "Charity", total: 100_000, recipientKind: "external_beneficiary" }),
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
      mkRecipient({ recipientLabel: "Charity", total: 100_000, recipientKind: "external_beneficiary" }),
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
  // The outer widget calls buildEstateTransferReportData() which requires a
  // full projection fixture. We keep one smoke test here that drives the
  // real pipeline end-to-end with an empty projection (forcing the empty
  // path). The render-level table behavior is covered by the
  // EstateBeneficiariesBlock tests below, which feed RecipientTotal[]
  // directly and avoid the need for projection fixtures.

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
});

describe("EstateBeneficiariesBlock (pure renderer)", () => {
  it("renders Beneficiary, Share, and Amount column headers", () => {
    const tree = renderToTree(
      <EstateBeneficiariesBlock
        recipients={[
          mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
          mkRecipient({
            recipientLabel: "Charity",
            total: 100_000,
            recipientKind: "external_beneficiary",
          }),
        ]}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("Beneficiary");
    expect(tree).toContain("Share");
    expect(tree).toContain("Amount");
  });

  it("renders beneficiary rows and the Total row with the supplied recipients", () => {
    const tree = renderToTree(
      <EstateBeneficiariesBlock
        recipients={[
          mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
          mkRecipient({
            recipientLabel: "Charity",
            total: 100_000,
            recipientKind: "external_beneficiary",
          }),
        ]}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
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

  it("filters out spouse recipients in the rendered block", () => {
    const tree = renderToTree(
      <EstateBeneficiariesBlock
        recipients={[
          mkRecipient({
            recipientLabel: "Blake-Spouse",
            total: 500_000,
            recipientKind: "spouse",
          }),
          mkRecipient({ recipientLabel: "Kids", total: 400_000 }),
        ]}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).not.toContain("Blake-Spouse");
    expect(tree).toContain("Kids");
  });

  it("shows the plan label when multiPlan is true and suppresses it when false", () => {
    const recipients = [mkRecipient({ recipientLabel: "Kids", total: 100_000 })];

    const multi = renderToTree(
      <EstateBeneficiariesBlock
        recipients={recipients}
        planLabel="Plan Alpha"
        multiPlan={true}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(multi).toContain("Plan Alpha");

    const single = renderToTree(
      <EstateBeneficiariesBlock
        recipients={recipients}
        planLabel="Plan Alpha"
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(single).not.toContain("Plan Alpha");
  });
});
