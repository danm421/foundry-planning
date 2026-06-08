import { describe, it, expect } from "vitest";
import {
  SHORT_DISCLAIMER,
  DISCLOSURES_HEADING,
  longDisclaimerParagraphs,
} from "../disclaimers";

describe("presentation disclaimers", () => {
  it("exposes a non-empty short disclaimer mentioning illustration", () => {
    expect(SHORT_DISCLAIMER.length).toBeGreaterThan(0);
    expect(SHORT_DISCLAIMER).toMatch(/illustrative/i);
  });

  it("exposes a disclosures heading", () => {
    expect(DISCLOSURES_HEADING).toBe("Important Disclosures");
  });

  it("interpolates firm, client, and date into the long disclaimer", () => {
    const paras = longDisclaimerParagraphs({
      firmName: "Acme Wealth",
      clientName: "Jane & John Doe",
      reportDate: "June 8, 2026",
    });
    expect(paras).toHaveLength(4);
    const joined = paras.join(" ");
    expect(joined).toContain("Acme Wealth");
    expect(joined).toContain("Jane & John Doe");
    expect(joined).toContain("June 8, 2026");
  });

  it("covers the core disclosure themes", () => {
    const joined = longDisclaimerParagraphs({
      firmName: "F",
      clientName: "C",
      reportDate: "D",
    }).join(" ");
    expect(joined).toMatch(/advice/i);
    expect(joined).toMatch(/past performance/i);
    expect(joined).toMatch(/loss of principal/i);
    expect(joined).toMatch(/current law/i);
  });
});
