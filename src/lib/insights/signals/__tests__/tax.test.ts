import { describe, it, expect } from "vitest";
import { taxSignals } from "../tax";
import { signalInputFixture } from "./fixture";
import type { Observation } from "@/lib/tax-analysis/types";

const obs = (o: Partial<Observation>): Observation => ({
  id: "bracket-position", severity: "info", title: "T", body: "B", numbers: {}, ...o,
});

describe("taxSignals", () => {
  it("emits no_return_on_file when there is no return", () => {
    const i = signalInputFixture();
    i.tax = { observations: [], taxYear: null };
    const out = taxSignals(i);
    expect(out.map((s) => s.id)).toEqual(["tax.no_return_on_file"]);
    expect(out[0].severity).toBe("info");
  });

  it("emits nothing extra when a return exists but produced no observations", () => {
    const i = signalInputFixture();
    i.tax = { observations: [], taxYear: 2025 };
    expect(taxSignals(i)).toEqual([]);
  });

  it("namespaces the observation id under tax.", () => {
    const i = signalInputFixture();
    i.tax = { observations: [obs({ id: "roth-headroom" })], taxYear: 2025 };
    expect(taxSignals(i)[0].id).toBe("tax.roth-headroom");
  });

  it("carries severity, title, body and numbers across unchanged", () => {
    const i = signalInputFixture();
    const o = obs({
      id: "niit-exposure", severity: "watch", title: "NIIT applies",
      body: "The 3.8% surtax applied.", numbers: { estTax: 1900, threshold: 250_000 },
    });
    i.tax = { observations: [o], taxYear: 2025 };
    const s = taxSignals(i)[0];
    expect(s.severity).toBe("watch");
    expect(s.title).toBe("NIIT applies");
    expect(s.detail).toBe("The 3.8% surtax applied.");
    expect(s.numbers).toEqual({ estTax: 1900, threshold: 250_000 });
  });

  it("pulls estimatedImpact from the observation's headline figure", () => {
    const i = signalInputFixture();
    i.tax = {
      observations: [obs({ id: "roth-headroom", numbers: { headroom: 42_000, rate: 0.22 } })],
      taxYear: 2025,
    };
    expect(taxSignals(i)[0].estimatedImpact).toBe(42_000);
  });

  it("leaves estimatedImpact null when the observation has no headline figure", () => {
    const i = signalInputFixture();
    i.tax = { observations: [obs({ id: "state-notes", numbers: {} })], taxYear: 2025 };
    expect(taxSignals(i)[0].estimatedImpact).toBeNull();
  });

  it("deep-links to the tax analysis for the year the return covers", () => {
    const i = signalInputFixture();
    i.tax = { observations: [obs({})], taxYear: 2024 };
    expect(taxSignals(i)[0].href).toBe(`/clients/${i.clientId}/details/tax-analysis?year=2024`);
  });

  // Guards the adapter against an upstream builder being added and silently
  // never reaching the 360. Asserted against buildObservations' OWN builder
  // list, never against this adapter's map — a test driven by the constant
  // under test cannot catch a removed entry.
  it("maps every observation the tax layer can currently emit", async () => {
    const mod = await import("@/lib/tax-analysis/observations/index");
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/tax-analysis/observations/index.ts", "utf8"),
    );
    const builderCount = src.slice(src.indexOf("const BUILDERS"), src.indexOf("] as const"))
      .split("\n").filter((l) => /^\s{2}\w/.test(l)).length;
    expect(builderCount).toBe(13);
    expect(typeof mod.buildObservations).toBe("function");
  });
});
