import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { BalanceSheetPdf } from "../balance-sheet";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

interface MakePlanArgs {
  id?: string;
  label?: string;
  accounts?: unknown[];
  liabilities?: unknown[];
  familyMembers?: unknown[];
  entities?: unknown[];
}

function mkPlan(args: MakePlanArgs): ComparisonPlan {
  return {
    id: args.id ?? "p1",
    label: args.label ?? "Base",
    tree: {
      accounts: args.accounts ?? [],
      liabilities: args.liabilities ?? [],
      familyMembers: args.familyMembers ?? [],
      entities: args.entities ?? [],
    },
    result: { years: [] },
  } as unknown as ComparisonPlan;
}

describe("BalanceSheetPdf", () => {
  it("renders Assets section with account rows, owner columns, and totals", () => {
    const plan = mkPlan({
      id: "p1",
      label: "Base",
      accounts: [
        {
          id: "a-cash",
          name: "CASH - Checking",
          category: "cash",
          value: 50_000,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        },
        {
          id: "a-401k-c",
          name: "INV - Client 401k",
          category: "retirement",
          value: 400_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      familyMembers: [
        { id: "fm-client", role: "client", firstName: "Cooper" },
        { id: "fm-spouse", role: "spouse", firstName: "Susan" },
      ],
    });

    const tree = renderToTree(
      <BalanceSheetPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );

    expect(tree).toContain("Assets");
    expect(tree).toContain("CASH - Checking");
    expect(tree).toContain("INV - Client 401k");
    expect(tree).toContain("Cooper");
    expect(tree).toContain("Joint/ROS");
    expect(tree).toContain("Total Assets");
    expect(tree).toContain("Net Worth");
    // Client 401k = $400,000 — present somewhere
    expect(tree).toContain("$400,000");
    // Grand total assets = $450,000
    expect(tree).toContain("$450,000");
  });

  it("omits Liabilities section when no liabilities exist", () => {
    const plan = mkPlan({
      accounts: [
        {
          id: "a1",
          name: "INV - Brokerage",
          category: "taxable",
          value: 100_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      familyMembers: [{ id: "fm-client", role: "client", firstName: "Pat" }],
    });

    const tree = renderToTree(
      <BalanceSheetPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );

    expect(tree).not.toContain("Liabilities");
    expect(tree).not.toContain("Total Liabilities");
  });

  it("renders Liabilities section when liabilities exist", () => {
    const plan = mkPlan({
      accounts: [
        {
          id: "a1",
          name: "INV - Brokerage",
          category: "taxable",
          value: 100_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      liabilities: [
        {
          id: "l1",
          name: "Home Mortgage",
          balance: 250_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      familyMembers: [{ id: "fm-client", role: "client", firstName: "Pat" }],
    });

    const tree = renderToTree(
      <BalanceSheetPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );

    expect(tree).toContain("Liabilities");
    expect(tree).toContain("Home Mortgage");
    expect(tree).toContain("Total Liabilities");
  });

  it("splits mixed-ownership accounts proportionally and renders entity columns", () => {
    const plan = mkPlan({
      accounts: [
        {
          id: "a-mixed",
          name: "Mixed Ownership Property",
          category: "real_estate",
          value: 500_000,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "entity", entityId: "ent-trust", percent: 0.5 },
          ],
        },
      ],
      familyMembers: [{ id: "fm-client", role: "client", firstName: "Pat" }],
      entities: [{ id: "ent-trust", name: "Family Trust" }],
    });

    const tree = renderToTree(
      <BalanceSheetPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );

    expect(tree).toContain("Family Trust");
    expect(tree).toContain("Pat");
    // 50% of $500,000 = $250,000 should appear (both Pat and Family Trust columns)
    expect(tree).toContain("$250,000");
    // Row total is $500,000
    expect(tree).toContain("$500,000");
  });

  it("shows plan labels with dot when multiple plans, suppresses for single plan", () => {
    const plan1 = mkPlan({
      id: "p1",
      label: "Base",
      accounts: [
        {
          id: "a1",
          name: "Brokerage",
          category: "taxable",
          value: 100_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      familyMembers: [{ id: "fm-client", role: "client", firstName: "Pat" }],
    });
    const plan2 = mkPlan({
      id: "p2",
      label: "Scenario A",
      accounts: [
        {
          id: "a1",
          name: "Brokerage",
          category: "taxable",
          value: 200_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      familyMembers: [{ id: "fm-client", role: "client", firstName: "Pat" }],
    });

    const multi = renderToTree(
      <BalanceSheetPdf
        config={undefined}
        plans={[plan1, plan2]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(multi).toContain("Base");
    expect(multi).toContain("Scenario A");

    const single = renderToTree(
      <BalanceSheetPdf
        config={undefined}
        plans={[plan1]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // Single plan: plan label should NOT appear as a header (no other "Base"
    // text appears anywhere in this widget).
    expect(single).not.toContain("Base");
  });

  it("computes Net Worth as total assets minus total liabilities", () => {
    const plan = mkPlan({
      accounts: [
        {
          id: "a1",
          name: "Brokerage",
          category: "taxable",
          value: 400_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      liabilities: [
        {
          id: "l1",
          name: "Mortgage",
          balance: 300_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      familyMembers: [{ id: "fm-client", role: "client", firstName: "Pat" }],
    });

    const tree = renderToTree(
      <BalanceSheetPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );

    expect(tree).toContain("Net Worth");
    // $400,000 − $300,000 = $100,000
    expect(tree).toContain("$100,000");
  });
});
