import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { EstateFlowChartPagePdf } from "../estate-flow-chart/page-pdf";
import { EstateFlowReportPagePdf } from "../estate-flow/page-pdf";
import type { EstateFlowChartData } from "@/lib/presentations/pages/estate-flow-chart/view-model";
import type { EstateFlowReportData } from "@/lib/presentations/pages/estate-flow/view-model";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { extractPdfText } from "@/lib/extraction/pdf-parser";

ensureFontsRegistered();

const framing = {
  firmName: "Foundry",
  clientName: "Cooper Sample",
  reportDate: "May 28, 2026",
  pageIndex: 1,
  totalPages: 1,
  accent: DEFAULT_ACCENT,
};

const emptyChart: EstateFlowChartData = {
  title: "Estate Flow",
  subtitle: "Base Case",
  summary: null,
  showHeirDetail: true,
};

const emptyReport: EstateFlowReportData = {
  title: "Estate Flow",
  subtitle: "Base Case",
  ownership: { groups: [], grandTotal: 0 },
  asOfYear: 2026,
  firstColumn: null,
  secondColumn: null,
  showHeirDetail: true,
};

// Populated chart fixture: a survivor net-worth box, a firstDeath stage with a
// taxes sub-box (DeathSpine + sub-boxes), one out-of-estate entity, and a heir
// box with a detail section (so the showHeirDetail path renders too).
const populatedChart: EstateFlowChartData = {
  title: "Estate Flow",
  subtitle: "Base Case",
  showHeirDetail: true,
  summary: {
    survivorNetWorth: {
      ownerLabel: "Linda",
      role: "spouse",
      amount: 600_000,
      lines: [{ label: "Joint Brokerage", amount: 600_000 }],
    },
    firstDeath: {
      decedentLabel: "Tom's Estate",
      year: 2030,
      estateValue: 1_000_000,
      estateLines: [],
      subBoxes: [
        { kind: "taxes", label: "Taxes & Expenses", total: -50_000, lines: [] },
        {
          kind: "inheritance_spouse",
          label: "To Co-client",
          total: 950_000,
          lines: [],
          targetLabel: "Linda's Estate",
        },
      ],
    },
    secondDeath: null,
    outOfEstate: {
      heirs: { total: 0, entities: [] },
      irrevTrusts: {
        total: 5_000_000,
        entities: [
          {
            entityId: "ilit-1",
            entityLabel: "Cooper ILIT",
            amount: 5_000_000,
            assets: [{ label: "Term policy", amount: 5_000_000 }],
          },
        ],
      },
    },
    heirBoxes: [
      {
        recipientKey: "child|casey",
        recipientLabel: "Casey Cooper",
        outright: 400_000,
        inTrust: 0,
        total: 400_000,
        sections: [
          {
            title: "At Linda's Death",
            lines: [{ label: "401k", amount: 400_000 }],
            subtotal: 400_000,
          },
        ],
        recipientGroups: { firstDeath: null, secondDeath: null },
        trustInterests: [],
      },
    ],
    totals: { totalTaxesAndExpenses: -50_000, totalToHeirs: 400_000 },
  },
};

// Populated report fixture: an ownership group with one asset carrying a linked
// liability (so the net-line renders) and a firstColumn death section with a
// spouse (a home, its mortgage and an empty account, all by titling, less a
// reduction) and heirs with no plan, plus a projected income tax.
const populatedReport: EstateFlowReportData = {
  title: "Estate Flow",
  subtitle: "Base Case",
  asOfYear: 2026,
  showHeirDetail: true,
  ownership: {
    grandTotal: 350_000,
    groups: [
      {
        key: "joint",
        kind: "joint",
        label: "Tom & Linda",
        subtotal: 350_000,
        assets: [
          {
            accountId: "home",
            rowKind: "account",
            isDefaultCash: false,
            name: "Home",
            accountType: "real_estate",
            value: 950_000,
            percent: 1,
            isSplit: false,
            linkedLiabilities: [
              { liabilityId: "mortgage", name: "Home Mortgage", balance: 600_000 },
            ],
            netValue: 350_000,
            hasBeneficiaries: false,
            hasConflict: false,
          },
        ],
      },
    ],
  },
  firstColumn: {
    decedent: "client",
    decedentName: "Tom",
    year: 2030,
    taxableEstate: 970_000,
    grossEstate: 970_000,
    assetEstateValue: 970_000,
    assetCount: 3,
    tax: { federal: 0, state: 0, inheritance: 0, ird: 18_500 },
    recipients: [
      {
        key: "spouse|",
        recipientKind: "spouse",
        recipientId: null,
        recipientLabel: "Linda Cooper",
        total: 350_000,
        netTotal: 345_000,
        drainsByKind: {
          federal_estate_tax: 0,
          state_estate_tax: 0,
          probate: 0,
          admin_expenses: 5_000,
          debts_paid: 0,
          ird_tax: 0,
        },
        byMechanism: [
          {
            mechanism: "titling",
            mechanismLabel: "Titling",
            total: 350_000,
            assets: [
              {
                sourceAccountId: "home",
                sourceLiabilityId: null,
                label: "Home",
                amount: 950_000,
                basis: 950_000,
                conflictIds: [],
              },
              {
                sourceAccountId: null,
                sourceLiabilityId: "mortgage",
                label: "Home Mortgage",
                amount: -600_000,
                basis: 0,
                conflictIds: [],
              },
              {
                sourceAccountId: "old-checking",
                sourceLiabilityId: null,
                label: "Old Checking",
                amount: 0,
                basis: 0,
                conflictIds: [],
              },
            ],
          },
        ],
      },
      {
        key: "system_default|",
        recipientKind: "system_default",
        recipientId: null,
        recipientLabel: "Other Heirs",
        total: 20_000,
        netTotal: 20_000,
        drainsByKind: {
          federal_estate_tax: 0,
          state_estate_tax: 0,
          probate: 0,
          admin_expenses: 0,
          debts_paid: 0,
          ird_tax: 0,
        },
        byMechanism: [
          {
            mechanism: "fallback_other_heirs",
            mechanismLabel: "Default order",
            total: 20_000,
            assets: [
              {
                sourceAccountId: "car",
                sourceLiabilityId: null,
                label: "Car",
                amount: 20_000,
                basis: 20_000,
                conflictIds: [],
              },
            ],
          },
        ],
      },
    ],
    reductions: [{ kind: "admin_expenses", label: "Admin Expenses", amount: -5_000 }],
    conflicts: [],
    grossEstateDollarsByAccount: {},
    grossEstateDollarsByLiability: {},
    reconciliation: {
      sumLiabilityTransfers: -600_000,
      sumRecipients: 370_000,
      sumReductions: -5_000,
      unattributed: 0,
      reconciles: true,
    },
  },
  secondColumn: null,
};

describe("estate page PDFs render", () => {
  it("chart renders with a null summary", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateFlowChartPagePdf({ data: emptyChart, ...framing })}</Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("chart renders a populated summary (spine, sub-boxes, OOE, heir detail)", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateFlowChartPagePdf({ data: populatedChart, ...framing })}</Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("report renders with empty columns", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateFlowReportPagePdf({ data: emptyReport, ...framing })}</Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("report renders populated ownership + death columns (net-line + recipients)", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateFlowReportPagePdf({ data: populatedReport, ...framing })}</Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("report's death column prints the shares, the folded accounts and the tax box", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateFlowReportPagePdf({ data: populatedReport, ...framing })}</Document>,
    );
    const text = (await extractPdfText(Buffer.from(buf))).replace(/\s+/g, " ");

    // Net is what the recipients receive after their share of the reductions.
    expect(text).toContain("Gross $370,000");
    expect(text).toContain("Net $365,000");
    // Each band's share of that net: 345,000 and 20,000 of 365,000.
    expect(text).toContain("95% of the total");
    expect(text).toMatch(/(?<!\d)5% of the total/);
    expect(text).toContain("No plan");
    // A debt carries a true minus; the $0 account folds into one line, and the
    // passes-by label prints once for the run of titled rows.
    expect(text).toContain("−$600,000");
    expect(text).not.toContain("Old Checking");
    expect(text).toContain("plus 1 account with no balance");
    expect(text.match(/Titling/g)).toHaveLength(1);
    expect(text).toContain("Gross $350,000");
    expect(text).toContain("Taxes, expenses and debts −$5,000");
    // The tax box is banded to its share of the estate at death.
    expect(text).toContain("Projected tax");
    expect(text).toMatch(/(?<!\d)5% of the estate/);
    expect(text).toContain("Income tax (IRD) $18,500");
    expect(text).not.toContain("State inheritance tax");
  });
});
