import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { EstateFlowChartPagePdf } from "../estate-flow-chart/page-pdf";
import { EstateFlowReportPagePdf } from "../estate-flow/page-pdf";
import type { EstateFlowChartData } from "@/lib/presentations/pages/estate-flow-chart/view-model";
import type { EstateFlowReportData } from "@/lib/presentations/pages/estate-flow/view-model";

ensureFontsRegistered();

const framing = {
  firmName: "Foundry",
  clientName: "Cooper Sample",
  reportDate: "May 28, 2026",
  pageIndex: 1,
  totalPages: 1,
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
          label: "To Spouse",
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
// liability (so the net-line renders) and a firstColumn death section with one
// recipient → one mechanism → one asset.
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
    taxableEstate: 950_000,
    assetEstateValue: 950_000,
    assetCount: 1,
    recipients: [
      {
        key: "spouse|",
        recipientKind: "spouse",
        recipientId: null,
        recipientLabel: "Linda Cooper",
        total: 950_000,
        netTotal: 945_000,
        drainsByKind: {
          federal_estate_tax: 0,
          state_estate_tax: 0,
          admin_expenses: -5_000,
          debts_paid: 0,
          ird_tax: 0,
        },
        byMechanism: [
          {
            mechanism: "titling",
            mechanismLabel: "Titling",
            total: 950_000,
            assets: [
              {
                sourceAccountId: "home",
                sourceLiabilityId: null,
                label: "Home",
                amount: 950_000,
                basis: 950_000,
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
      sumLiabilityTransfers: 0,
      sumRecipients: 945_000,
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
});
