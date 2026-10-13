// src/lib/fact-finder/__tests__/chat-view.test.ts
import { describe, expect, it } from "vitest";
import { factFinderView, sectionView } from "../chat/view";
import { FACT_FINDER_SECTIONS } from "../schema";
import { emptyFactFinderState } from "../state";
import type { FactFinderState, FFCell, FFCellValue, FFHolding, FFRow } from "../types";

const AT = "2026-10-12T12:00:00.000Z";
const doc = (value: FFCellValue, confidence = 0.92): FFCell => ({
  value,
  confidence,
  by: "document",
  source: { fileId: "f1", page: 2 },
});
const row = (id: string, cells: Record<string, FFCell>, extra: Partial<FFRow> = {}): FFRow => ({
  id,
  cells,
  sourceFileIds: ["f1"],
  ...extra,
});
const holding = (id: string, ticker: string | null, marketValue: number, name: string | null = null): FFHolding => ({
  id,
  ticker,
  name,
  shares: null,
  price: null,
  marketValue,
  costBasis: null,
  by: "document",
});
const FILES = [
  { id: "f1", name: "hendricks-fact-finder.pdf" },
  { id: "f2", name: "schwab-june.pdf" },
  { id: "f3", name: "new-scan.pdf" },
];

function fixture(): FactFinderState {
  const s = emptyFactFinderState();
  const [client, coClient] = s.sections.people;
  return {
    ...s,
    sections: {
      ...s.sections,
      people: [{ ...client, cells: { firstName: doc("Mark"), lastName: doc("Hendricks") } }, coClient],
      cash: [
        row(
          "c1",
          {
            accountName: doc("Joint Checking"),
            currentValue: doc(12500),
            owner: doc("Joint", 0.5),
            last4: { value: null, by: "advisor", pinned: true },
          },
          {
            link: { kind: "existing", recordId: "acct-1", score: 0.74, confirmed: false, by: "auto" },
            linkCandidates: [
              { recordId: "acct-1", label: "Joint Checking ··1234", score: 0.74 },
              { recordId: "acct-2", label: "Savings ··9999", score: 0.52 },
            ],
          },
        ),
        row("c2", { accountName: doc("Emergency Fund") }, { link: { kind: "new", by: "advisor" } }),
      ],
      taxable: [
        row("t1", { accountName: doc("Joint Brokerage") }, {
          link: { kind: "existing", recordId: "acct-3", score: 1, confirmed: true, by: "auto" },
          linkCandidates: [{ recordId: "acct-3", label: "Joint Brokerage ··7781", score: 1 }],
          holdings: [
            holding("h1", "VTI", 60000),
            holding("h2", "BND", 30000),
            holding("h3", null, 500, "Cash sweep"),
            holding("h4", "AAPL", 9000),
          ],
        }),
      ],
    },
    removed: [{ sectionId: "cash", row: row("c9", { accountName: doc("Old Savings") }), reason: "Closed in 2025", by: "advisor", at: AT }],
    unassignedHoldings: [{ ...holding("u1", "MSFT", 4200, "Microsoft"), accountHint: "IRA ··4321" }],
    readings: {
      f1: { status: "done", reader: "form", startedAt: AT, finishedAt: AT, rows: 4 },
      f2: { status: "failed", startedAt: AT, finishedAt: AT, reason: "Couldn't read any text from this file." },
    },
  };
}

describe("factFinderView", () => {
  it("lists every live row with its id, its label and only its filled cells", () => {
    const view = factFinderView(fixture(), FILES);
    expect(view).toContain('- c1 "Joint Checking": accountName="Joint Checking" currentValue=12500 owner="Joint" (check)');
    expect(view).not.toContain("last4");
    expect(view).toContain('- people:Client "Client & Co-client — Client": firstName="Mark" lastName="Hendricks"');
    expect(view).toContain('- people:Co-client "Client & Co-client — Co-client": (no values)');
  });

  it("shows each row's link and its candidates with their record ids", () => {
    const view = factFinderView(fixture(), FILES);
    expect(view).toContain(
      'links to "Joint Checking ··1234" (acct-1) 74% — needs a click; candidates: acct-1 "Joint Checking ··1234" 74%, acct-2 "Savings ··9999" 52%',
    );
    expect(view).toContain('- c2 "Emergency Fund": accountName="Emergency Fund" | links to a new record');
    expect(view).toContain('links to "Joint Brokerage ··7781" (acct-3) 100% — confirmed');
  });

  it("summarizes each account's holdings instead of listing them", () => {
    const view = factFinderView(fixture(), FILES);
    expect(view).toContain('| 4 holdings, total 99500, largest "VTI", "BND", "AAPL"');
    expect(view).not.toMatch(/\bh[1-4]\b/);
    expect(view).not.toContain("Cash sweep");
  });

  it("lists the Removed tray, holdings with no account, and each document's reading", () => {
    const view = factFinderView(fixture(), FILES);
    expect(view).toContain('## Removed tray\n- c9 in cash "Old Savings" — removed: "Closed in 2025"');
    expect(view).toContain('## Holdings with no account\n- u1 "MSFT", value 4200 — account hint "IRA ··4321"');
    expect(view).toContain(
      [
        "## Documents",
        '- "hendricks-fact-finder.pdf": read (4 rows)',
        '- "schwab-june.pdf": couldn\'t be read — "Couldn\'t read any text from this file."',
        '- "new-scan.pdf": not read yet',
      ].join("\n"),
    );
  });

  it("names every section, even an empty one", () => {
    const view = factFinderView(emptyFactFinderState(), []);
    for (const section of FACT_FINDER_SECTIONS) expect(view).toContain(`## ${section.id} — ${section.label}\n`);
    expect(view).toContain("## family — Children, Grandchildren & Other Heirs\n(no rows)");
    expect(view).toContain("## Removed tray\n(none)");
    expect(view).toContain("## Documents\n(none)");
  });
});

describe("sectionView", () => {
  it("shows a section's columns with each choice's options, and every holding with its id", () => {
    const view = sectionView(fixture(), "taxable");
    expect(view).toContain("## taxable — Taxable Investment Accounts\nRows can be added, removed and merged.");
    expect(view).toContain('currentValue "Current value" (money)');
    expect(view).toContain('owner "Owner" (choice: "Client" | "Co-client" | "Joint" | "Trust / entity")');
    expect(view).toContain('  - holding h1: ticker="VTI" marketValue=60000');
    expect(view).toContain('  - holding h3: name="Cash sweep" marketValue=500');
    expect(view).toContain("  - holding h4:");
  });

  it("shows the section's removed rows with their values", () => {
    expect(sectionView(fixture(), "cash")).toContain(
      'Removed from this section:\n- c9 "Old Savings" — removed: "Closed in 2025" | accountName="Old Savings"',
    );
  });

  it("says when a section's rows are fixed", () => {
    expect(sectionView(fixture(), "people")).toContain("Fixed rows: fill them in — they can't be added or removed.");
  });

  it("refuses a section that doesn't exist", () => {
    expect(() => sectionView(fixture(), "nope")).toThrow('There\'s no fact finder section "nope".');
  });
});

describe("an SSN never reaches the model (Review Focus 5)", () => {
  const SSNS = ["123-45-6789", "123 45 6789", "123456789"];

  function withSsns(): FactFinderState {
    const s = fixture();
    return {
      ...s,
      sections: {
        ...s.sections,
        family: [row("k1", { notes: doc(`Jackie's SSN is ${SSNS[0]}`) })],
        insurance_notes: [{ ...s.sections.insurance_notes[0], cells: { notes: doc(`Group life, member id ${SSNS[1]}`) } }],
        taxable: [{ ...s.sections.taxable[0], holdings: [holding("h1", null, 5000, `Trust fund ${SSNS[2]}`)] }],
      },
      removed: [
        {
          sectionId: "cash",
          row: row("c9", { accountName: doc(`Savings for ${SSNS[0]}`), custodian: doc(`Bank ${SSNS[1]}`) }),
          reason: `Duplicate of ${SSNS[2]}`,
          by: "advisor",
          at: AT,
        },
      ],
      unassignedHoldings: [{ ...holding("u1", null, 100, `Fund ${SSNS[0]}`), accountHint: `Acct ${SSNS[1]}` }],
    };
  }

  it("is redacted in the fact finder view, every section view and the file names", () => {
    const state = withSsns();
    const files = [{ id: "f1", name: `scan ${SSNS[0]}.pdf` }];
    const views = [
      factFinderView(state, files),
      ...["family", "insurance_notes", "taxable", "cash"].map((id) => sectionView(state, id)),
    ];
    for (const view of views) {
      for (const ssn of SSNS) expect(view).not.toContain(ssn);
      expect(view).toContain("[REDACTED-SSN]");
    }
  });
});
