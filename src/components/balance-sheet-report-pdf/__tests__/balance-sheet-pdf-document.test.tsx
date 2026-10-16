import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { wordBoxes, renderedPages, BBOX_EPS } from "@/components/presentations/shared/test-utils/pdf-bbox";
import {
  BalanceSheetPdfDocument,
  type BalanceSheetPdfProps,
  type BalanceSheetPdfView,
} from "../balance-sheet-pdf-document";
import type { HouseholdColumnsModel, OwnerColumnRow } from "../../balance-sheet-report/household-columns";
import type { EntityGroup } from "../../balance-sheet-report/view-model";
import type { TrustDetails } from "@/lib/balance-sheet/trust-details";

const cols = (client: number, spouse: number, joint: number) => ({ client, spouse, joint, total: client + spouse + joint });

const row = (key: string, name: string, c: ReturnType<typeof cols>, over: Partial<OwnerColumnRow> = {}): OwnerColumnRow => ({
  key,
  name,
  hasLinkedMortgage: false,
  ...c,
  ...over,
});

const household: HouseholdColumnsModel = {
  selectedYear: 2031,
  hasSpouse: true,
  assetCategories: [
    {
      key: "taxable",
      label: "Taxable",
      ...cols(6_000_000, 4_000_000, 2_345_678),
      rows: [
        row("b1", "Joint Brokerage", cols(0, 0, 2_345_678), { marginLoan: 50_000 }),
        row("b2", "John's Brokerage", cols(6_000_000, 0, 0), { revocableTrustName: "Smith Living Trust" }),
        row("b3", "Jane's Brokerage", cols(0, 4_000_000, 0)),
      ],
    },
    {
      key: "realEstate",
      label: "Real Estate",
      ...cols(0, 0, 900_000),
      rows: [row("h1", "Residence", cols(0, 0, 900_000), { hasLinkedMortgage: true })],
    },
  ],
  liabilityRows: [row("m1", "Mortgage", cols(0, 0, 300_000))],
  totalAssets: cols(6_000_000, 4_000_000, 3_245_678),
  totalLiabilities: cols(0, 0, 300_000),
  netWorth: cols(6_000_000, 4_000_000, 2_945_678),
};

const householdView: BalanceSheetPdfView = {
  kind: "household",
  household,
  donut: [
    { key: "taxable", label: "Taxable", value: 12_345_678, hex: "#2d61aa" },
    { key: "realEstate", label: "Real Estate", value: 900_000, hex: "#c2941b" },
  ],
  outOfEstate: {
    selectedYear: 2031,
    outOfEstateNetWorth: 750_000,
    outOfEstateOwnerRows: [
      { ownerKey: "en:t1", ownerName: "Family ILIT", ownerType: "trust", assetTotal: 750_000, liabilityTotal: 0, net: 750_000 },
    ],
  },
  clientLabel: "John",
  spouseLabel: "Jane",
};

const entityGroup = (over: Partial<EntityGroup>): EntityGroup => ({
  entityId: "e",
  entityName: "Entity",
  entityType: "trust",
  assetRows: [{ rowKey: "a", accountName: "Trust Brokerage", value: 750_000 }] as EntityGroup["assetRows"],
  assetTotal: 750_000,
  liabilityRows: [],
  liabilityTotal: 0,
  netWorth: 750_000,
  ...over,
});

const trustDetails: TrustDetails[] = [
  {
    entityId: "t1",
    subTypeLabel: "ILIT",
    trustee: "First National Bank",
    grantor: "John",
    powers: ["Irrevocable"],
    beneficiaries: [{ group: "Primary", name: "Emma Smith", percentage: 100 }],
  },
];

const entitiesView: BalanceSheetPdfView = {
  kind: "entities",
  groups: [
    entityGroup({ entityId: "t1", entityName: "Family ILIT" }),
    entityGroup({
      entityId: "b1",
      entityName: "Smith LLC",
      entityType: "llc",
      liabilityRows: [{ rowKey: "l1", liabilityName: "Equipment Loan", balance: 40_000 }] as EntityGroup["liabilityRows"],
    }),
  ],
  trustDetails,
};

const base: Omit<BalanceSheetPdfProps, "view"> = {
  clientName: "John Smith",
  subtitle: "Household · End of 2031 · Ages 69 & 67",
  scenarioName: "Retire at 62",
  generatedAt: "Oct 16, 2026",
  firmName: "Ethos Financial Group",
  logoDataUrl: null,
  accentColor: "#123456",
};

describe("BalanceSheetPdfDocument — household view", () => {
  it("prints the on-screen owner columns, rows, totals and Out of Estate table", () => {
    const html = renderToTree(<BalanceSheetPdfDocument {...base} view={householdView} />);
    for (const text of [
      "Balance Sheet — John Smith",
      "Household · End of 2031 · Ages 69 &amp; 67",
      "Scenario: Retire at 62",
      "Ethos Financial Group",
      "Assets by Type",
      "Net Worth Summary",
      "Jane",
      "Joint",
      "Joint Brokerage",
      "after $50,000 margin loan",
      "Smith Living Trust",
      "(M)",
      "($300,000)",
      "Total Assets",
      "Total Liabilities",
      "$12,945,678",
      "Out of Estate",
      "Net (2031)",
      "Family ILIT",
    ]) {
      expect(html).toContain(text);
    }
    // A zero owner cell prints as a dash, like the screen.
    expect(html).toContain("—");
  });

  it("hides the spouse and Joint columns for a single-client household", () => {
    const single: BalanceSheetPdfView = { ...householdView, spouseLabel: null, household: { ...household, hasSpouse: false } };
    const html = renderToTree(<BalanceSheetPdfDocument {...base} view={single} />);
    expect(html).not.toContain(">Joint<");
    expect(html).not.toContain(">Jane<");
  });

  it("renders a real PDF whose widest figures stay on the page, without key warnings", async () => {
    const calls: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => {
      calls.push(String(a[0]));
    });
    const pdf = await renderToBuffer(<BalanceSheetPdfDocument {...base} view={householdView} />);
    expect(calls.find((c) => c.includes("same key"))).toBeUndefined();
    expect(renderedPages(pdf)).toBe(1);
    const words = wordBoxes(pdf);
    expect(words.some((w) => w.text === "$12,345,678")).toBe(true);
    for (const w of words) expect(w.xMax).toBeLessThanOrEqual(612 - 32 + BBOX_EPS);
  });

  it("draws a lone asset category as a full pie", async () => {
    const lone: BalanceSheetPdfView = { ...householdView, donut: [householdView.donut[0]] } as BalanceSheetPdfView;
    const pdf = await renderToBuffer(<BalanceSheetPdfDocument {...base} view={lone} />);
    expect(wordBoxes(pdf).some((w) => w.text === "100%")).toBe(true);
  });

  afterEach(() => vi.restoreAllMocks());
});

describe("BalanceSheetPdfDocument — By Entity view", () => {
  it("prints each entity card, with trust details beside trusts only", () => {
    const html = renderToTree(<BalanceSheetPdfDocument {...base} view={entitiesView} />);
    for (const text of [
      "Family ILIT",
      "Smith LLC",
      "LLC",
      "Trust Brokerage",
      "Equipment Loan",
      "($40,000)",
      "Trust Details",
      "First National Bank",
      "Primary beneficiaries",
      "Emma Smith",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/Trust Details/g)).toHaveLength(1);
    expect(html).not.toContain("Assets by Type");
  });

  it("says so when there are no entities", () => {
    const html = renderToTree(
      <BalanceSheetPdfDocument {...base} view={{ kind: "entities", groups: [], trustDetails: [] }} />,
    );
    expect(html).toContain("No business or trust entities.");
  });

  it("renders a real PDF", async () => {
    const pdf = await renderToBuffer(<BalanceSheetPdfDocument {...base} view={entitiesView} />);
    expect(wordBoxes(pdf).some((w) => w.text === "Family")).toBe(true);
  });
});
