import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PresentationDocument } from "../document";
import type { PageScenarioBundle } from "../document";
import type { PresentationPageId } from "../registry";

/** What `earlyYearsDebtOrInvest` needs to survive its own omit check: an
 *  amortizing loan for one arm, and a movable payroll deferral for the other. */
const LOAN = {
  id: "l1", name: "Student loan", balance: 30_000, interestRate: 0.055,
  monthlyPayment: 350, startYear: 2024, startMonth: 1, termMonths: 120,
  extraPayments: [], owners: [],
};
const RULE = {
  id: "r1", accountId: "a1", annualAmount: 0, annualPercent: 0.08,
  isDeductible: true, startYear: 2020, endYear: 2060,
};
const INCOME = {
  id: "i1", type: "salary", name: "Salary", annualAmount: 120_000, owner: "client",
  growthRate: 0, startYear: 2020, endYear: 2060,
};

// A minimal tree/projection: only what the Cover, TOC and the page under test read.
const bundle = (over: Record<string, unknown> = {}): PageScenarioBundle =>
  ({
    clientData: {
      planSettings: { planStartYear: 2026, inflationRate: 0.03 },
      client: { firstName: "Cooper", currentAge: 29, retirementAge: 65 },
      liabilities: [],
      savingsRules: [],
      incomes: [],
      accounts: [],
      ...over,
    },
    projection: { years: [{ year: 2026, ages: { client: 29 } }] },
    scenarioLabel: "Base Case",
  }) as unknown as PageScenarioBundle;

function docProps(base: PageScenarioBundle) {
  return {
    pages: [] as { pageId: PresentationPageId; scenarioKey: string }[],
    firmName: "Ethos Financial Group",
    firmTagline: null,
    firmLogoDataUrl: null,
    accentColor: "#b08d3f",
    clientName: "Cooper Sample",
    reportDate: "August 20, 2026",
    spouseName: null,
    spouseLastName: null,
    headerName: "Cooper",
    bundles: { base },
    topScenarioKey: "base",
  };
}

function doc(pageIds: PresentationPageId[], base: PageScenarioBundle) {
  return PresentationDocument({
    ...docProps(base),
    pages: pageIds.map((pageId) => ({ pageId, scenarioKey: "base" })),
  });
}

async function textOf(element: ReturnType<typeof doc>): Promise<string> {
  const buf = await renderToBuffer(element);
  const dir = mkdtempSync(join(tmpdir(), "omit-"));
  try {
    const pdf = join(dir, "d.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "d.txt")]);
    return readFileSync(join(dir, "d.txt"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("omitFromDeck", () => {
  it("drops a self-suppressing page from the deck and from the contents list", async () => {
    // earlyYearsDebtOrInvest omits itself on a plan with no amortizing debt.
    // The TOC is in the deck on purpose: it prints every kept page's title, so
    // one assertion covers both the sheet and the contents list.
    const text = await textOf(doc(["cover", "toc", "earlyYearsDebtOrInvest"], bundle()));
    expect(text).not.toContain("Pay Down the Loan");
  });

  it("keeps the page when the plan can support it", async () => {
    const text = await textOf(
      doc(
        ["earlyYearsDebtOrInvest"],
        bundle({ liabilities: [LOAN], savingsRules: [RULE], incomes: [INCOME] }),
      ),
    );
    expect(text).toContain("Pay Down the Loan");
  });

  it("never empties the Document — react-pdf throws with no Page", async () => {
    const text = await textOf(doc(["earlyYearsDebtOrInvest"], bundle()));
    expect(text.trim().length).toBeGreaterThan(0);
  });

  // The second omit user, and the first whose trigger is a page OPTION rather
  // than the plan's own facts: an advisor who added the notes page and picked
  // nothing gets no sheet, not a heading over blank paper.
  it("drops the notes page when the advisor picked no tidbits", async () => {
    const text = await textOf(doc(["cover", "toc", "earlyYearsTidbits"], bundle()));
    expect(text).not.toContain("Things Worth Knowing");
  });

  it("keeps the notes page once something is picked", async () => {
    // Cover and TOC are load-bearing, not scenery. With the notes page ALONE in
    // the deck, `document.tsx`'s never-empty rescue puts a suppressed page back —
    // so a one-page deck renders the sheet whether the omit rule fired or not,
    // and this assertion would pass against an omit rule hardcoded to `true`.
    // Proven: that mutation went green until these two pages were added.
    const text = await textOf(
      PresentationDocument({
        ...docProps(bundle()),
        pages: [
          { pageId: "cover" as PresentationPageId, scenarioKey: "base" },
          { pageId: "toc" as PresentationPageId, scenarioKey: "base" },
          {
            pageId: "earlyYearsTidbits" as PresentationPageId,
            scenarioKey: "base",
            options: { tidbits: ["compounding-rule-of-72"] },
          },
        ],
      }),
    );
    expect(text).toContain("Things Worth Knowing");
    expect(text).toContain("Divide 72");
  });

  // The rescue path: a deck of nothing but self-suppressing sheets keeps one
  // back rather than throwing. That sheet reaches a CLIENT, so it must not carry
  // instructions aimed at the advisor who built the deck.
  it("rescues the last page without printing build instructions at the client", async () => {
    const text = await textOf(doc(["earlyYearsTidbits"], bundle()));
    expect(text).toContain("No notes were selected");
    expect(text).not.toContain("options");
  });
});
