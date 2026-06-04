/**
 * Fixture-driven headless render script for the Scenario Changes PDF page.
 *
 * Usage:
 *   npx tsx scripts/render-scenario-changes.ts
 *
 * Writes /tmp/scenario-changes.pdf, then rasterizes to /tmp/scenario-changes-1.png
 * via pdftoppm.  No DB or auth required — pure fixture data.
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import React from "react";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { buildScenarioChangesData } from "../src/lib/presentations/pages/scenario-changes/view-model";
import { SCENARIO_CHANGES_OPTIONS_DEFAULT } from "../src/lib/presentations/pages/scenario-changes/options-schema";
import { ScenarioChangesPagePdf } from "../src/components/presentations/pages/scenario-changes/page-pdf";
import { ensureFontsRegistered } from "../src/components/pdf/fonts";
import { DEFAULT_ACCENT } from "../src/lib/presentations/theme";
import type { ScenarioChangesContext } from "../src/lib/presentations/pages/scenario-changes/types";

ensureFontsRegistered();

const mk = (over: Record<string, unknown>) => ({
  id: over.id ?? "c",
  scenarioId: "s",
  toggleGroupId: null,
  orderIndex: 0,
  ...over,
});

const ctx: ScenarioChangesContext = {
  baseLabel: "your current plan",
  toggleGroups: [],
  targetNames: {
    "savings_rule:sr": "401(k) contribution",
    "transfer:tr": "cash to business",
    "asset_transaction:at": "Sell Real Estate",
    "roth_conversion:rc": "Roth ladder",
    "will:w": "Cooper's will",
    "expense:ex": "Retirement Living Expenses",
  },
  resolve: {
    accountsById: {
      roth: { name: "Roth 401(k)", category: "retirement", subType: "roth_401k" },
      jb: { name: "Joint Brokerage", category: "taxable" },
      biz: { name: "Business", category: "business" },
      home: { name: "Rental Home", category: "real_estate" },
      ira: { name: "Traditional IRA", category: "retirement" },
      rira: { name: "Roth IRA", category: "retirement" },
      brk: { name: "Brokerage", category: "taxable" },
    },
    recipientsById: {
      "family_member:f1": "Jane Cooper",
      "family_member:f2": "John Cooper",
    },
    entitiesById: {},
    spouseName: "Susan",
    modelPortfoliosById: {
      mp: { name: "Growth 70/30", rate: 0.065 },
    },
    baseAllocationsById: {
      brk: { mix: "80/20 stock/bond", blendedRate: 0.072 },
    },
    // Projection-derived buy/sell figures, keyed by transaction id. Mirrors what
    // the export route injects from `projection.years[].techniqueBreakdown`.
    assetTxById: {
      at: {
        type: "sell",
        saleValue: 920000,
        netProceeds: 612000,
        capitalGain: 540000,
        transactionCosts: 18000,
        mortgagePaidOff: 290000,
      },
    },
  },
  changes: [
    mk({
      id: "1",
      targetKind: "client",
      targetId: "p1",
      opType: "edit",
      payload: { retirementAge: { from: 65, to: 67 } },
    }),
    mk({
      id: "2",
      targetKind: "expense",
      targetId: "ex",
      opType: "edit",
      payload: { annualAmount: { from: 100000, to: 150000 } },
    }),
    mk({
      id: "3",
      targetKind: "savings_rule",
      targetId: "sr",
      opType: "add",
      payload: {
        accountId: "roth",
        annualAmount: 20000,
        rothPercent: 1,
        employerMatchPct: 0.5,
        employerMatchCap: 0.06,
        startYear: 2026,
      },
    }),
    mk({
      id: "4",
      targetKind: "transfer",
      targetId: "tr",
      opType: "add",
      payload: {
        sourceAccountId: "jb",
        targetAccountId: "biz",
        amount: 250000,
        mode: "one_time",
        startYear: 2027,
      },
    }),
    mk({
      id: "5",
      targetKind: "asset_transaction",
      targetId: "at",
      opType: "add",
      payload: {
        // No overrideSaleValue — value + net come from the projection (assetTxById).
        type: "sell",
        accountId: "home",
        proceedsAccountId: "jb",
        year: 2030,
        qualifiesForHomeSaleExclusion: true,
      },
    }),
    mk({
      id: "6",
      targetKind: "reinvestment",
      targetId: "ri",
      opType: "add",
      payload: {
        accountIds: ["brk"],
        groupKeys: [],
        year: 2030,
        targetType: "model_portfolio",
        modelPortfolioId: "mp",
        realizeTaxesOnSwitch: true,
      },
    }),
    mk({
      id: "7",
      targetKind: "roth_conversion",
      targetId: "rc",
      opType: "add",
      payload: {
        conversionType: "fixed_amount",
        fixedAmount: 50000,
        sourceAccountIds: ["ira"],
        destinationAccountId: "rira",
        startYear: 2028,
        endYear: 2033,
      },
    }),
    mk({
      id: "8",
      targetKind: "will",
      targetId: "w",
      opType: "edit",
      payload: {
        bequests: {
          from: [
            {
              id: "b1",
              kind: "asset",
              assetMode: "all_assets",
              percentage: 1,
              condition: "always",
              recipients: [
                { recipientKind: "spouse", recipientId: null, percentage: 1 },
              ],
            },
          ],
          to: [
            {
              id: "b1",
              kind: "asset",
              assetMode: "all_assets",
              percentage: 1,
              condition: "always",
              recipients: [
                { recipientKind: "spouse", recipientId: null, percentage: 1 },
              ],
            },
            {
              id: "b2",
              kind: "asset",
              assetMode: "specific",
              accountId: "roth",
              percentage: 1,
              condition: "if_spouse_predeceased",
              recipients: [
                {
                  recipientKind: "family_member",
                  recipientId: "f1",
                  percentage: 0.5,
                },
                {
                  recipientKind: "family_member",
                  recipientId: "f2",
                  percentage: 0.5,
                },
              ],
            },
          ],
        },
      },
    }),
  ] as ScenarioChangesContext["changes"],
};

const data = buildScenarioChangesData(ctx, SCENARIO_CHANGES_OPTIONS_DEFAULT);

const element = ScenarioChangesPagePdf({
  data,
  firmName: "Foundry Financial",
  clientName: "Cooper & Susan Sample",
  reportDate: "2026-06-04",
  pageIndex: 1,
  totalPages: 1,
  accent: DEFAULT_ACCENT,
});

(async () => {
  const buf = await renderToBuffer(React.createElement(Document, null, element));
  writeFileSync("/tmp/scenario-changes.pdf", buf);
  console.log("PDF written to /tmp/scenario-changes.pdf");

  try {
    execFileSync("pdftoppm", ["-r", "150", "-png", "/tmp/scenario-changes.pdf", "/tmp/scenario-changes"]);
    console.log("PNG written to /tmp/scenario-changes-1.png");
  } catch (e) {
    console.warn("pdftoppm not available — PDF written but not rasterized:", (e as Error).message);
  }

  console.log("done", {
    units: data.units.length,
    isEmpty: data.isEmpty,
    title: data.title,
    subtitle: data.subtitle,
  });
})();
