import { describe, it, expect } from "vitest";
import { buildEstateFlowGraph, type BuildGraphInput } from "../estate-flow-sankey";
import type { EstateTransferReportData, DeathSectionData } from "@/lib/estate/transfer-report";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

// ── Shared empty report ───────────────────────────────────────────────────────

const EMPTY_REPORT: EstateTransferReportData = {
  ordering: "primaryFirst",
  asOfLabel: "Today",
  firstDeath: null,
  secondDeath: null,
  aggregateRecipientTotals: [],
  isEmpty: true,
};

function input(overrides: Partial<BuildGraphInput>): BuildGraphInput {
  return {
    reportData: EMPTY_REPORT,
    clientData: { accounts: [], entities: [], familyMembers: [], giftEvents: [] } as unknown as ClientData,
    gifts: [] as EstateFlowGift[],
    ownerNames: { clientName: "Pat", spouseName: "Sam" },
    ...overrides,
  };
}

// ── Empty report ──────────────────────────────────────────────────────────────

describe("buildEstateFlowGraph", () => {
  it("returns an empty graph for an empty report", () => {
    const graph = buildEstateFlowGraph(input({}));
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
  });
});

// ── Fixture builders ──────────────────────────────────────────────────────────

/**
 * Build a DeathSectionData fixture. Default: client dies in 2041, leaving $900
 * to Kid A via will with $100 in federal estate tax.
 *
 * Note: RecipientGroup.key follows the transfer-report format:
 *   `${recipientKind}|${recipientId ?? ""}`
 */
function deathSection(over: Partial<DeathSectionData> = {}): DeathSectionData {
  return {
    decedent: "client",
    decedentName: "Pat",
    year: 2041,
    taxableEstate: 0,
    assetEstateValue: 1000,
    assetCount: 1,
    recipients: [
      {
        key: "family_member|kid",
        recipientKind: "family_member",
        recipientId: "kid",
        recipientLabel: "Kid A",
        total: 900,
        netTotal: 900,
        drainsByKind: {
          federal_estate_tax: 0,
          state_estate_tax: 0,
          admin_expenses: 0,
          debts_paid: 0,
          ird_tax: 0,
        },
        byMechanism: [
          {
            mechanism: "will",
            mechanismLabel: "Specific Bequest",
            total: 900,
            assets: [
              {
                sourceAccountId: "a1",
                sourceLiabilityId: null,
                label: "Brokerage",
                amount: 900,
                basis: 0,
                conflictIds: [],
              },
            ],
          },
        ],
      },
    ],
    reductions: [
      { kind: "federal_estate_tax", label: "Federal estate tax", amount: 100 },
    ],
    conflicts: [],
    reconciliation: {
      sumLiabilityTransfers: 0,
      sumRecipients: 900,
      sumReductions: 100,
      unattributed: 0,
      reconciles: true,
    },
    ...over,
  };
}

function singleFilerData(): ClientData {
  return {
    client: { firstName: "Pat", spouseName: null, dateOfBirth: "1960-01-01" },
    familyMembers: [
      { id: "fm-c", role: "client", firstName: "Pat", lastName: null, dateOfBirth: "1960-01-01", relationship: "child" },
    ],
    entities: [],
    accounts: [
      {
        id: "a1",
        name: "Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: 1000,
        basis: 0,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
      },
    ],
    liabilities: [],
    wills: [],
    giftEvents: [],
    planSettings: { inflationRate: 0.02 },
  } as unknown as ClientData;
}

// ── Single filer ──────────────────────────────────────────────────────────────

describe("buildEstateFlowGraph — single filer", () => {
  it("builds owner -> final + tax-sink with conserved value", () => {
    const report: EstateTransferReportData = {
      ordering: "primaryFirst",
      asOfLabel: "Both die in 2041",
      firstDeath: deathSection(),
      secondDeath: null,
      aggregateRecipientTotals: [],
      isEmpty: false,
    };
    const graph = buildEstateFlowGraph(
      input({ reportData: report, clientData: singleFilerData() }),
    );

    const owner = graph.nodes.find((n) => n.kind === "owner");
    const kid = graph.nodes.find((n) => n.kind === "finalBeneficiary");
    const tax = graph.nodes.find((n) => n.kind === "taxSink");

    // Owner node value includes the proportional tax share for conservation.
    // The brokerage account ($900 to kid + $100 tax) = $1000 total owner outflow.
    expect(owner?.value).toBe(1000);
    expect(kid?.value).toBe(900);
    expect(tax?.value).toBe(100);

    const owners = graph.nodes.filter((n) => n.kind === "owner");
    const finals = graph.nodes.filter((n) => n.kind === "finalBeneficiary");
    const sinks = graph.nodes.filter((n) => n.kind === "taxSink");
    const sum = (ns: typeof graph.nodes) => ns.reduce((s, n) => s + n.value, 0);
    // Conservation: sum(owners) == sum(finals) + sum(taxSinks)
    expect(sum(owners)).toBeCloseTo(sum(finals) + sum(sinks), 2);

    const willLink = graph.links.find((l) => l.mechanism === "will");
    expect(willLink?.assets[0].label).toBe("Brokerage");
  });
});

// ── Married two-death ─────────────────────────────────────────────────────────

describe("buildEstateFlowGraph — married", () => {
  it("threads a single spouse-pool node between the two deaths", () => {
    const first = deathSection({
      recipients: [
        {
          key: "spouse|",
          recipientKind: "spouse",
          recipientId: null,
          recipientLabel: "Sam",
          total: 700,
          netTotal: 700,
          drainsByKind: {
            federal_estate_tax: 0,
            state_estate_tax: 0,
            admin_expenses: 0,
            debts_paid: 0,
            ird_tax: 0,
          },
          byMechanism: [
            {
              mechanism: "titling",
              mechanismLabel: "Account Titling",
              total: 700,
              assets: [
                {
                  sourceAccountId: "a1",
                  sourceLiabilityId: null,
                  label: "Joint Home",
                  amount: 700,
                  basis: 0,
                  conflictIds: [],
                },
              ],
            },
          ],
        },
        {
          key: "family_member|kid",
          recipientKind: "family_member",
          recipientId: "kid",
          recipientLabel: "Kid A",
          total: 200,
          netTotal: 200,
          drainsByKind: {
            federal_estate_tax: 0,
            state_estate_tax: 0,
            admin_expenses: 0,
            debts_paid: 0,
            ird_tax: 0,
          },
          byMechanism: [
            {
              mechanism: "beneficiary_designation",
              mechanismLabel: "Beneficiary Designation",
              total: 200,
              assets: [
                {
                  sourceAccountId: "a2",
                  sourceLiabilityId: null,
                  label: "IRA",
                  amount: 200,
                  basis: 0,
                  conflictIds: [],
                },
              ],
            },
          ],
        },
      ],
      reductions: [{ kind: "federal_estate_tax", label: "Federal estate tax", amount: 100 }],
    });

    const second = deathSection({
      decedent: "spouse",
      decedentName: "Sam",
      year: 2047,
      assetEstateValue: 700,
      recipients: [
        {
          key: "family_member|kid",
          recipientKind: "family_member",
          recipientId: "kid",
          recipientLabel: "Kid A",
          total: 650,
          netTotal: 650,
          drainsByKind: {
            federal_estate_tax: 0,
            state_estate_tax: 0,
            admin_expenses: 0,
            debts_paid: 0,
            ird_tax: 0,
          },
          byMechanism: [
            {
              mechanism: "will",
              mechanismLabel: "Specific Bequest",
              total: 650,
              assets: [
                {
                  sourceAccountId: "a1",
                  sourceLiabilityId: null,
                  label: "Joint Home",
                  amount: 650,
                  basis: 0,
                  conflictIds: [],
                },
              ],
            },
          ],
        },
      ],
      reductions: [{ kind: "federal_estate_tax", label: "Federal estate tax", amount: 50 }],
    });

    const report: EstateTransferReportData = {
      ordering: "primaryFirst",
      asOfLabel: "Both die in 2041",
      firstDeath: first,
      secondDeath: second,
      aggregateRecipientTotals: [],
      isEmpty: false,
    };

    const graph = buildEstateFlowGraph(input({ reportData: report }));

    const pools = graph.nodes.filter((n) => n.kind === "spousePool");
    expect(pools).toHaveLength(1);
    expect(pools[0].value).toBeCloseTo(650 + 50, 2);

    const kidNodes = graph.nodes.filter(
      (n) => n.kind === "finalBeneficiary" && n.id === "final:family_member|kid",
    );
    expect(kidNodes).toHaveLength(1);
    expect(kidNodes[0].value).toBeCloseTo(200 + 650, 2);
  });
});

// ── Gift links ─────────────────────────────────────────────────────────────────

describe("buildEstateFlowGraph — gift links", () => {
  it("emits a gift link and includes gift amount in final node value", () => {
    // Single filer, no death section transfers; just a gift
    const report: EstateTransferReportData = {
      ordering: "primaryFirst",
      asOfLabel: "Today",
      firstDeath: deathSection({
        recipients: [
          {
            key: "family_member|kid",
            recipientKind: "family_member",
            recipientId: "kid",
            recipientLabel: "Kid A",
            total: 900,
            netTotal: 900,
            drainsByKind: {
              federal_estate_tax: 0,
              state_estate_tax: 0,
              admin_expenses: 0,
              debts_paid: 0,
              ird_tax: 0,
            },
            byMechanism: [
              {
                mechanism: "will",
                mechanismLabel: "Specific Bequest",
                total: 900,
                assets: [
                  {
                    sourceAccountId: "a1",
                    sourceLiabilityId: null,
                    label: "Brokerage",
                    amount: 900,
                    basis: 0,
                    conflictIds: [],
                  },
                ],
              },
            ],
          },
        ],
        reductions: [],
      }),
      secondDeath: null,
      aggregateRecipientTotals: [],
      isEmpty: false,
    };

    const giftData: ClientData = {
      ...singleFilerData(),
      accounts: [
        {
          id: "a1",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 1000,
          basis: 0,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
        },
        {
          id: "a2",
          name: "Gift Account",
          category: "taxable",
          subType: "brokerage",
          value: 500,
          basis: 0,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
        },
      ],
    } as unknown as ClientData;

    const gifts: EstateFlowGift[] = [
      {
        kind: "asset-once",
        id: "g1",
        year: 2035,
        accountId: "a2",
        percent: 1.0,
        grantor: "client",
        recipient: { kind: "family_member", id: "kid2" },
      },
    ];

    const graph = buildEstateFlowGraph(input({ reportData: report, clientData: giftData, gifts }));

    // A gift link exists
    const giftLinks = graph.links.filter((l) => l.mechanism === "gift");
    expect(giftLinks).toHaveLength(1);
    expect(giftLinks[0].value).toBe(500); // 100% of account value

    // The gift recipient final node exists and has the gift value
    const kidGiftNode = graph.nodes.find((n) => n.id === "final:family_member|kid2");
    expect(kidGiftNode).toBeDefined();
    expect(kidGiftNode?.value).toBe(500);

    // Conservation: all outflows from owner nodes equal finals + tax sinks
    const ownerNodeTotal = graph.nodes
      .filter((n) => n.kind === "owner")
      .reduce((s, n) => s + n.value, 0);
    const outboundLinks = graph.links.reduce((s, l) => {
      // Only count links from owner nodes
      if (graph.nodes.find((n) => n.id === l.sourceId)?.kind === "owner") {
        return s + l.value;
      }
      return s;
    }, 0);
    expect(ownerNodeTotal).toBeCloseTo(outboundLinks, 2);
  });
});

// ── Multiple gifts, same grantor + recipient → distinct link IDs ───────────

describe("buildEstateFlowGraph — gift link ID uniqueness", () => {
  it("produces distinct link IDs when two cash-once gifts share the same grantor and recipient", () => {
    const report: EstateTransferReportData = {
      ordering: "primaryFirst",
      asOfLabel: "Today",
      firstDeath: deathSection(),
      secondDeath: null,
      aggregateRecipientTotals: [],
      isEmpty: false,
    };

    const gifts: EstateFlowGift[] = [
      {
        kind: "cash-once",
        id: "gift-A",
        year: 2030,
        amount: 17000,
        grantor: "client",
        recipient: { kind: "family_member", id: "kid" },
        crummey: false,
      },
      {
        kind: "cash-once",
        id: "gift-B",
        year: 2031,
        amount: 18000,
        grantor: "client",
        recipient: { kind: "family_member", id: "kid" },
        crummey: false,
      },
    ];

    const graph = buildEstateFlowGraph(
      input({ reportData: report, clientData: singleFilerData(), gifts }),
    );

    const ids = graph.links.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Both gift amounts should be reflected in the recipient's final node value
    const kidGiftNode = graph.nodes.find((n) => n.id === "final:family_member|kid");
    expect(kidGiftNode).toBeDefined();
    // The node accumulates both gifts (17000 + 18000 = 35000) on top of death transfer (900)
    expect(kidGiftNode!.value).toBeCloseTo(900 + 17000 + 18000, 2);

    // Both gift links exist
    const giftLinks = graph.links.filter((l) => l.mechanism === "gift");
    expect(giftLinks).toHaveLength(2);
  });
});

// ── Second-death-only graph (no firstDeath) ───────────────────────────────────

describe("buildEstateFlowGraph — second-death-only", () => {
  it("does not throw and produces a valid graph when firstDeath is null", () => {
    const report: EstateTransferReportData = {
      ordering: "primaryFirst",
      asOfLabel: "Spouse dies in 2047",
      firstDeath: null,
      secondDeath: deathSection({
        decedent: "spouse",
        decedentName: "Sam",
        year: 2047,
        assetEstateValue: 1000,
      }),
      aggregateRecipientTotals: [],
      isEmpty: false,
    };

    // Should not throw
    const graph = buildEstateFlowGraph(input({ reportData: report, clientData: singleFilerData() }));

    // A spousePool node is emitted to represent the second-death estate
    const pool = graph.nodes.find((n) => n.kind === "spousePool");
    expect(pool).toBeDefined();

    // Final beneficiary node(s) exist
    const finals = graph.nodes.filter((n) => n.kind === "finalBeneficiary");
    expect(finals.length).toBeGreaterThan(0);

    // All link IDs are unique
    const ids = graph.links.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
