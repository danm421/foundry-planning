import { describe, it, expect } from "vitest";
import { taxSignals } from "../tax";
import { signalInputFixture } from "./fixture";
import type { Finding } from "@/lib/tax-analysis/types";

// Every prose field is DELIBERATELY distinct so an assertion cannot pass by
// matching the wrong part — "the string is on the signal somewhere" is exactly
// the vacuity that let a label/body swap through on the tax branch.
const finding = (f: Partial<Finding>): Finding => ({
  id: "bracket-position",
  severity: "info",
  category: "brackets",
  headline: "HEADLINE",
  whatTheReturnShows: "SHOWS",
  whyItMatters: "MATTERS",
  whatToConsider: "CONSIDER",
  lineRefs: [],
  estimatedImpact: null,
  numbers: {},
  ...f,
});

describe("taxSignals", () => {
  it("emits no_return_on_file when there is no return", () => {
    const i = signalInputFixture();
    i.tax = { findings: [], taxYear: null };
    const out = taxSignals(i);
    expect(out.map((s) => s.id)).toEqual(["tax.no_return_on_file"]);
    expect(out[0].severity).toBe("info");
  });

  it("emits nothing extra when a return exists but produced no findings", () => {
    const i = signalInputFixture();
    i.tax = { findings: [], taxYear: 2025 };
    expect(taxSignals(i)).toEqual([]);
  });

  it("namespaces the finding id under tax.", () => {
    const i = signalInputFixture();
    i.tax = { findings: [finding({ id: "roth-headroom" })], taxYear: 2025 };
    expect(taxSignals(i)[0].id).toBe("tax.roth-headroom");
  });

  it("carries severity, headline, evidence and numbers across unchanged", () => {
    const i = signalInputFixture();
    const f = finding({
      id: "niit-exposure",
      severity: "watch",
      category: "investments",
      headline: "NIIT applies",
      whatTheReturnShows: "The 3.8% surtax applied to $50,000 of net investment income.",
      numbers: { estTax: 1900, threshold: 250_000 },
    });
    i.tax = { findings: [f], taxYear: 2025 };
    const s = taxSignals(i)[0];
    expect(s.severity).toBe("watch");
    expect(s.title).toBe("NIIT applies");
    expect(s.detail).toBe("The 3.8% surtax applied to $50,000 of net investment income.");
    expect(s.numbers).toEqual({ estTax: 1900, threshold: 250_000 });
  });

  // The four-part body means "detail" now has three candidate sources. Pin WHICH
  // one, or swapping them stays green: the old single `body` field had no such
  // ambiguity and no test guarded against it.
  it("takes detail from whatTheReturnShows, not from whyItMatters or whatToConsider", () => {
    const i = signalInputFixture();
    i.tax = { findings: [finding({})], taxYear: 2025 };
    const s = taxSignals(i)[0];
    expect(s.detail).toBe("SHOWS");
    expect(s.detail).not.toBe("MATTERS");
    expect(s.detail).not.toBe("CONSIDER");
    expect(s.title).toBe("HEADLINE");
  });

  // The adapter used to guess each observation's headline figure from a local
  // IMPACT_KEY table, which silently yielded null whenever it named a key the
  // builder did not emit. Findings publish their own impact, so the adapter
  // passes it straight through — including the null.
  it("passes the finding's own estimatedImpact straight through", () => {
    const i = signalInputFixture();
    i.tax = {
      findings: [finding({ id: "roth-headroom", estimatedImpact: 42_000, numbers: { headroom: 42_000 } })],
      taxYear: 2025,
    };
    expect(taxSignals(i)[0].estimatedImpact).toBe(42_000);
  });

  it("keeps estimatedImpact null when the finding does not support a figure", () => {
    const i = signalInputFixture();
    i.tax = {
      findings: [finding({ id: "state-notes", estimatedImpact: null, numbers: { rate: 0.031 } })],
      taxYear: 2025,
    };
    expect(taxSignals(i)[0].estimatedImpact).toBeNull();
  });

  // A non-null `numbers` entry must NOT be mistaken for an impact now that the
  // lookup table is gone — the only source is estimatedImpact itself.
  it("does not resurrect an impact from numbers when estimatedImpact is null", () => {
    const i = signalInputFixture();
    i.tax = {
      findings: [
        finding({ id: "charitable-bunching", estimatedImpact: null, numbers: { charitable: 20_000 } }),
      ],
      taxYear: 2025,
    };
    expect(taxSignals(i)[0].estimatedImpact).toBeNull();
  });

  it("deep-links to the tax analysis for the year the return covers", () => {
    const i = signalInputFixture();
    i.tax = { findings: [finding({})], taxYear: 2024 };
    expect(taxSignals(i)[0].href).toBe(`/clients/${i.clientId}/details/tax-analysis?year=2024`);
  });

  // Guards the adapter against an upstream builder being added and silently
  // never reaching the 360. Asserted against buildFindings' OWN builder list,
  // never against this adapter's map — a test driven by the constant under test
  // cannot catch a removed entry. The count stays HARD-CODED on purpose.
  it("maps every finding the tax layer can currently emit", async () => {
    const mod = await import("@/lib/tax-analysis/findings/index");
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/tax-analysis/findings/index.ts", "utf8"),
    );
    const builderCount = src.slice(src.indexOf("const BUILDERS"), src.indexOf("] as const"))
      .split("\n").filter((l) => /^\s{2}\w/.test(l)).length;
    expect(builderCount).toBe(22);
    expect(typeof mod.buildFindings).toBe("function");
  });
});
