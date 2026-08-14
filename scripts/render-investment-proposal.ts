/**
 * Fixture-driven headless render script for the Investment Proposal PDF page.
 *
 * Usage:
 *   npx tsx scripts/render-investment-proposal.ts            # all sections
 *   npx tsx scripts/render-investment-proposal.ts --empty     # the empty state
 *
 * Writes /tmp/investment-proposal.pdf. No DB or auth required — pure fixture
 * data, so it renders the same sheets an export would for that snapshot.
 *
 * A tree assertion cannot see a react-pdf LAYOUT bug. Read the sheets:
 *   pdftotext -layout /tmp/investment-proposal.pdf -
 * and check overflow with bounding boxes, never by eye:
 *   pdftotext -bbox /tmp/investment-proposal.pdf -
 */
import { writeFileSync } from "node:fs";
import React from "react";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { buildInvestmentProposalData } from "../src/lib/presentations/pages/investment-proposal/view-model";
import {
  INVESTMENT_PROPOSAL_OPTIONS_DEFAULT,
} from "../src/lib/presentations/pages/investment-proposal/options-schema";
import { estimateInvestmentProposalPageCount } from "../src/lib/presentations/pages/investment-proposal/estimate-page-count";
import { InvestmentProposalPagePdf } from "../src/components/presentations/pages/investment-proposal/page-pdf";
import { ensureFontsRegistered } from "../src/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "../src/lib/presentations/theme";
import { BUNDLE } from "../src/lib/presentations/pages/investment-proposal/__tests__/fixtures/snapshot";

ensureFontsRegistered();

const empty = process.argv.includes("--empty");
const options = { ...INVESTMENT_PROPOSAL_OPTIONS_DEFAULT, proposalId: "p1" };
const data = buildInvestmentProposalData(empty ? undefined : BUNDLE, options);
const reserved = estimateInvestmentProposalPageCount(undefined, options);

const doc = React.createElement(
  Document,
  null,
  InvestmentProposalPagePdf({
    data,
    firmName: "Foundry Wealth",
    clientName: "Cooper & Susan Sample",
    reportDate: "August 12, 2026",
    pageIndex: 1,
    totalPages: reserved,
    accent: SECTION_ACCENTS.Assets!,
  }),
);

async function main() {
  const buf = await renderToBuffer(doc as never);
  writeFileSync("/tmp/investment-proposal.pdf", buf);
  console.log(`wrote /tmp/investment-proposal.pdf — ${reserved} sheets reserved`);
}

void main();
