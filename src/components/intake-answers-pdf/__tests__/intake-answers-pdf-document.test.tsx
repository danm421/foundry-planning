import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { PAGE_PAD_X, PAGE_WIDTH_PORTRAIT } from "@/components/presentations/shared/page-frame";
import { BBOX_EPS, renderedPages, wordBoxes } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { SHORT_DISCLAIMER } from "@/lib/presentations/disclaimers";
import { IntakeAnswersPdfDocument, type IntakeAnswersPdfProps } from "../intake-answers-pdf-document";
import type { IntakeAnswersDocument } from "@/lib/intake/answers-document";

const doc = (over: Partial<IntakeAnswersDocument> = {}): IntakeAnswersDocument => ({
  householdName: "Jane & John Doe",
  completedBy: "Jane Doe · jane@example.com",
  sentOn: "September 28, 2026",
  submittedOn: "October 3, 2026",
  sections: [
    {
      key: "family",
      title: "Family",
      blocks: [
        {
          kind: "people",
          people: [
            { role: "Client", name: "Jane Doe", fields: [{ label: "Date of birth", value: "Apr 2, 1975" }] },
            { role: "Co-client", name: "John Doe", fields: [{ label: "Date of birth", value: "Nov 30, 1977" }] },
          ],
        },
      ],
    },
    {
      key: "accounts",
      title: "Accounts",
      blocks: [
        {
          kind: "table",
          columns: [
            { label: "Account", flex: 2 },
            { label: "Value", flex: 1, align: "right" },
          ],
          rows: [{ cells: ["401(k)", "$450,000"] }, { cells: ["Brokerage", "$120,000"] }],
          total: ["Total", "$570,000"],
        },
      ],
    },
    {
      key: "goals",
      title: "Goals",
      blocks: [
        { kind: "list", heading: "On their radar", items: ["Charitable giving"] },
        { kind: "quote", heading: "In their words", text: "We may need to help my mother." },
      ],
    },
    { key: "documents", title: "Documents", blocks: [{ kind: "empty", text: "No documents uploaded." }] },
  ],
  ...over,
});

const props = (over: Partial<IntakeAnswersPdfProps> = {}): IntakeAnswersPdfProps => ({
  doc: doc(),
  firmName: "Ethos Financial Group",
  logoDataUrl: null,
  accentColor: "#1f4e79",
  ...over,
});

describe("IntakeAnswersPdfDocument", () => {
  it("prints the cover, the submission strip and every section", () => {
    const tree = renderToTree(<IntakeAnswersPdfDocument {...props()} />);
    expect(tree).toContain("DATA COLLECTION");
    expect(tree).toContain("Ethos Financial Group");
    expect(tree).toContain("Jane &amp; John Doe");
    expect(tree).toContain("Submitted October 3, 2026");
    expect(tree).toContain("Jane Doe · jane@example.com");
    expect(tree).toContain("September 28, 2026");
    for (const text of ["Family", "Accounts", "Goals", "Documents", "$570,000", "Charitable giving", "No documents uploaded."]) {
      expect(tree).toContain(text);
    }
    // No plan sits behind this document, so the cover names no scenario.
    expect(tree).not.toContain("Scenario");
  });

  it("wears its own footer line, not the deck's projection disclaimer", () => {
    const tree = renderToTree(<IntakeAnswersPdfDocument {...props()} />);
    expect(tree).toContain("Answers as provided by the client.");
    expect(tree).not.toContain(SHORT_DISCLAIMER);
  });

  it("drops the Sent cell when the form was never mailed", () => {
    const tree = renderToTree(<IntakeAnswersPdfDocument {...props({ doc: doc({ sentOn: null }) })} />);
    expect(tree).not.toContain(">Sent<");
  });

  it("keeps a long form inside the page margins as it flows onto more sheets", async () => {
    // Forty accounts with long names — enough to spill past the first sheet.
    const rows = Array.from({ length: 40 }, (_, i) => ({
      cells: [`Rollover IRA at a custodian with a very long legal name, number ${i + 1}`, "$1,234,567"],
    }));
    const long = doc({
      sections: [
        {
          key: "accounts",
          title: "Accounts",
          blocks: [
            {
              kind: "table",
              columns: [
                { label: "Account", flex: 2 },
                { label: "Value", flex: 1, align: "right" },
              ],
              rows,
            },
          ],
        },
      ],
    });
    const pdf = await renderToBuffer(<IntakeAnswersPdfDocument {...props({ doc: long })} />);
    const pages = renderedPages(pdf);
    expect(pages).toBeGreaterThanOrEqual(3); // cover + at least two content sheets

    // The cover is a full-bleed design; every content sheet keeps the frame's margins.
    for (let page = 2; page <= pages; page++) {
      for (const w of wordBoxes(pdf, page)) {
        expect(w.xMin, `"${w.text}" on page ${page}`).toBeGreaterThanOrEqual(PAGE_PAD_X - BBOX_EPS);
        expect(w.xMax, `"${w.text}" on page ${page}`).toBeLessThanOrEqual(PAGE_WIDTH_PORTRAIT - PAGE_PAD_X + BBOX_EPS);
      }
    }
    // The last account made it onto paper.
    const last = wordBoxes(pdf, pages).map((w) => w.text);
    expect(last).toContain("40");
  }, 60_000);
});
