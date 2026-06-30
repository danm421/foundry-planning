import { describe, it, expect } from "vitest";
import { buildPageOutline } from "../page-outline";

// Mirrors the real Ethos "Base Facts" report: every page leads with the same
// disclaimer + "Disclosures" + a "Version … Page N of 9" footer (whose version
// string and page number vary), and only THEN the section heading. The
// classifier was previously fed an empty outline, so income that lived on the
// middle pages (7–8) was never seen. The outline must surface each page's real
// heading while discarding the repeated header/footer noise.
const DISCLAIMER =
    "This analysis must be reviewed in conjunction with the limitations and conditions disclosed in the Disclaimer page. Projections are based on assumptions provided by the advisor/representative, and are not guaranteed.";

function footer(page: number): string {
    // Pages 1–3 and 4–9 carry different version strings in the real doc.
    const version = page <= 3 ? "1.1.1491.1739" : "10.3.1094.16115";
    return `Version ${version} - Prepared on June 30, 2026 for Alan Bradshaw and Teresa Cox by Ethos Financial Group - Personal and Confidential Page ${page} of 9`;
}

const HEADINGS: Record<number, string> = {
    1: "Profile | Base Facts",
    2: "Balance Sheet | Base Facts",
    3: "Qualified Retirement",
    4: "Liabilities and Expenses Details | Base Facts",
    5: "Advisor Fees",
    6: "Insurance Details | Base Facts",
    7: "Income, Transfers and Savings Details | Base Facts",
    8: "Income, Deferred",
    9: "VA Benefit",
};

function ethosPage(page: number): string {
    return [
        DISCLAIMER,
        "Disclosures",
        footer(page),
        HEADINGS[page],
        `body content line for page ${page}`,
    ].join("\n");
}

const ETHOS_PAGES = Array.from({ length: 9 }, (_, i) => ethosPage(i + 1));

describe("buildPageOutline", () => {
    it("emits one 1-indexed entry per page", () => {
        const outline = buildPageOutline(ETHOS_PAGES);
        const lines = outline.split("\n");
        expect(lines).toHaveLength(9);
        expect(lines[0].startsWith("Page 1:")).toBe(true);
        expect(lines[8].startsWith("Page 9:")).toBe(true);
    });

    it("surfaces the real section heading on each page", () => {
        const outline = buildPageOutline(ETHOS_PAGES);
        const line7 = outline.split("\n")[6];
        expect(line7).toContain("Income, Transfers and Savings Details");
        const line1 = outline.split("\n")[0];
        expect(line1).toContain("Profile");
    });

    it("strips the repeated disclaimer and 'Disclosures' boilerplate", () => {
        const outline = buildPageOutline(ETHOS_PAGES);
        expect(outline).not.toContain("This analysis must be reviewed");
        expect(outline).not.toContain("Disclosures");
    });

    it("strips the per-page footer even though version strings and page numbers differ", () => {
        const outline = buildPageOutline(ETHOS_PAGES);
        // Footer differs digit-for-digit per page; digit-normalized de-dup must
        // still recognize it as boilerplate and drop it from every page.
        expect(outline).not.toContain("Personal and Confidential");
        expect(outline).not.toContain("Prepared on");
        expect(outline).not.toMatch(/Version \d/);
    });

    it("does not over-strip on short documents where boilerplate can't be inferred", () => {
        const outline = buildPageOutline([
            "Account Statement\nFidelity Brokerage ****1234\nMarket value $50,000",
            "Holdings detail\nAAPL 100 shares",
        ]);
        expect(outline.split("\n")).toHaveLength(2);
        expect(outline).toContain("Account Statement");
        expect(outline).toContain("Holdings detail");
    });

    it("returns an empty string for no pages", () => {
        expect(buildPageOutline([])).toBe("");
    });
});
