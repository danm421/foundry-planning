import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { GiftTaxPdf } from "../gift-tax";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

interface GrantorYearStateFixture {
  taxableGiftsThisYear: number;
  cumulativeTaxableGifts: number;
  creditUsed: number;
  giftTaxThisYear: number;
  cumulativeGiftTax: number;
}

interface LedgerYearFixture {
  year: number;
  giftsGiven: number;
  taxableGiftsGiven: number;
  perGrantor: {
    client: GrantorYearStateFixture;
    spouse?: GrantorYearStateFixture;
  };
  totalGiftTax: number;
}

interface MakePlanArgs {
  id?: string;
  label?: string;
  ledger?: LedgerYearFixture[];
  client?: {
    firstName?: string;
    dateOfBirth?: string;
    filingStatus?: "single" | "married_joint";
    spouseDob?: string;
    spouseName?: string;
  };
}

function emptyState(): GrantorYearStateFixture {
  return {
    taxableGiftsThisYear: 0,
    cumulativeTaxableGifts: 0,
    creditUsed: 0,
    giftTaxThisYear: 0,
    cumulativeGiftTax: 0,
  };
}

function mkPlan(args: MakePlanArgs = {}): ComparisonPlan {
  return {
    id: args.id ?? "p1",
    label: args.label ?? "A",
    tree: {
      client: args.client ?? {
        firstName: "Avery",
        dateOfBirth: "1975-06-20",
        filingStatus: "married_joint",
        spouseDob: "1979-01-01",
        spouseName: "Blake",
      },
      familyMembers: [],
    },
    result: {
      giftLedger: args.ledger ?? [],
    },
  } as unknown as ComparisonPlan;
}

describe("GiftTaxPdf", () => {
  it("renders Year header and year + age cells", () => {
    const plan = mkPlan({
      ledger: [
        {
          year: 2030,
          giftsGiven: 15_000,
          taxableGiftsGiven: 0,
          perGrantor: { client: emptyState(), spouse: emptyState() },
          totalGiftTax: 0,
        },
        {
          year: 2031,
          giftsGiven: 0,
          taxableGiftsGiven: 0,
          perGrantor: { client: emptyState(), spouse: emptyState() },
          totalGiftTax: 0,
        },
      ],
    });
    const tree = renderToTree(
      <GiftTaxPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Year");
    expect(tree).toContain("Age");
    expect(tree).toContain("2030");
    expect(tree).toContain("2031");
    // ages: client born 1975 → in 2030 is 55; spouse born 1979 → 51
    expect(tree).toContain("55/51");
    expect(tree).toContain("56/52");
  });

  it("renders client and spouse columns when spouse exists", () => {
    const plan = mkPlan({
      client: {
        firstName: "Avery",
        dateOfBirth: "1975-06-20",
        filingStatus: "married_joint",
        spouseDob: "1979-01-01",
        spouseName: "Blake",
      },
      ledger: [
        {
          year: 2030,
          giftsGiven: 15_000,
          taxableGiftsGiven: 0,
          perGrantor: { client: emptyState(), spouse: emptyState() },
          totalGiftTax: 0,
        },
      ],
    });
    const tree = renderToTree(
      <GiftTaxPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Avery Cumul. Gifts");
    expect(tree).toContain("Blake Cumul. Gifts");
    expect(tree).toContain("Avery Credit Used");
    expect(tree).toContain("Blake Credit Used");
  });

  it("drops spouse columns when there is no spouse", () => {
    const plan = mkPlan({
      client: {
        firstName: "Avery",
        dateOfBirth: "1975-06-20",
        filingStatus: "single",
      },
      ledger: [
        {
          year: 2030,
          giftsGiven: 15_000,
          taxableGiftsGiven: 0,
          perGrantor: { client: emptyState() },
          totalGiftTax: 0,
        },
      ],
    });
    const tree = renderToTree(
      <GiftTaxPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Avery Cumul. Gifts");
    expect(tree).not.toContain("Spouse Cumul. Gifts");
    // single-client should show just the age (no "/")
    expect(tree).toContain("55");
    expect(tree).not.toContain("55/");
  });

  it("renders currency cells with $1,234 formatting", () => {
    const plan = mkPlan({
      ledger: [
        {
          year: 2030,
          giftsGiven: 15_000,
          taxableGiftsGiven: 0,
          perGrantor: { client: emptyState(), spouse: emptyState() },
          totalGiftTax: 0,
        },
      ],
    });
    const tree = renderToTree(
      <GiftTaxPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("$15,000");
  });

  it("renders an em-dash for zero values", () => {
    const plan = mkPlan({
      ledger: [
        {
          year: 2031,
          giftsGiven: 0,
          taxableGiftsGiven: 0,
          perGrantor: { client: emptyState(), spouse: emptyState() },
          totalGiftTax: 0,
        },
      ],
    });
    const tree = renderToTree(
      <GiftTaxPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // dash character used by Intl.NumberFormat fallback path in screen widget fmt.
    expect(tree).toContain("—");
  });

  it("shows plan labels for multi-plan and suppresses them for single-plan", () => {
    const planA = mkPlan({ id: "A", label: "Plan Alpha" });
    const planB = mkPlan({ id: "B", label: "Plan Beta" });

    const multi = renderToTree(
      <GiftTaxPdf
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
      <GiftTaxPdf
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
