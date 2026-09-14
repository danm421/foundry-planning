// src/lib/entity-extraction/__tests__/placement.test.ts
import { describe, it, expect } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { placeRow, coerce } from "../placement";

const life = findEntity("life_insurance_policy")!;
const valueOf = (row: ReturnType<typeof placeRow>, key: string) =>
  row.values.find((v) => v.key === key);

describe("coerce", () => {
  it("parses money with a currency symbol and separators", () => {
    expect(coerce("money", "$1,234,567.89")).toEqual({ ok: true, value: 1234567.89 });
  });

  it("parses a parenthesised negative as negative", () => {
    expect(coerce("money", "($1,200.00)")).toEqual({ ok: true, value: -1200 });
  });

  it("keeps a rate as a decimal fraction", () => {
    expect(coerce("rate", "0.03")).toEqual({ ok: true, value: 0.03 });
  });

  it("keeps a percent as a whole number — never divides by 100", () => {
    expect(coerce("percent", "3")).toEqual({ ok: true, value: 3 });
    expect(coerce("percent", "60%")).toEqual({ ok: true, value: 60 });
  });

  it("normalises a US date to ISO", () => {
    expect(coerce("date", "06/30/2026")).toEqual({ ok: true, value: "2026-06-30" });
  });

  it("rejects a year that is not four digits", () => {
    expect(coerce("year", "26")).toEqual({ ok: false });
  });

  it("reads a boolean from yes and no", () => {
    expect(coerce("boolean", "Yes")).toEqual({ ok: true, value: true });
    expect(coerce("boolean", "no")).toEqual({ ok: true, value: false });
  });

  it("rejects a money value it cannot parse", () => {
    expect(coerce("money", "see attached schedule")).toEqual({ ok: false });
  });

  it("accepts an already-structured object, which is what ownerRef is", () => {
    expect(coerce("object", { kind: "joint" })).toEqual({ ok: true, value: { kind: "joint" } });
  });

  it("rejects a scalar for a structured field", () => {
    expect(coerce("object", "joint")).toEqual({ ok: false });
    expect(coerce("array", "a, b")).toEqual({ ok: false });
  });

  it("accepts an already-structured array", () => {
    expect(coerce("array", [1, 2])).toEqual({ ok: true, value: [1, 2] });
  });
});

describe("placeRow", () => {
  it("keeps a clean value with no issue", () => {
    const row = placeRow(life, {
      name: { value: "Term Life 20", snippet: "Policy: Term Life 20", confidence: 0.95 },
      faceValue: { value: "$500,000", snippet: "Face Amount $500,000", confidence: 0.97 },
      policyType: { value: "term", snippet: "Term", confidence: 0.9 },
      insuredPerson: { value: "client", snippet: "Insured: Michael", confidence: 0.9 },
      ownerRef: { value: "client", snippet: "Owner: Michael", confidence: 0.9 },
    }, "r1");
    expect(valueOf(row, "faceValue")).toMatchObject({ value: 500000, issue: undefined });
  });

  it("flags an off-enum value instead of passing it through", () => {
    const row = placeRow(life, {
      policyType: { value: "Universal Life", snippet: "Universal Life", confidence: 0.9 },
    }, "r1");
    expect(valueOf(row, "policyType")!.issue).toBe("enum");
  });

  it("flags a value that will not coerce", () => {
    const row = placeRow(life, {
      faceValue: { value: "see schedule", snippet: "see schedule", confidence: 0.8 },
    }, "r1");
    expect(valueOf(row, "faceValue")!.issue).toBe("coercion");
  });

  it("reports required fields nothing filled", () => {
    const row = placeRow(life, {
      name: { value: "Term Life 20", snippet: "Term Life 20", confidence: 0.9 },
    }, "r1");
    expect(row.missingRequired).toContain("ownerRef");
    expect(row.missingRequired).toContain("faceValue");
  });

  it("does not count a flagged value as filling its required field", () => {
    const row = placeRow(life, {
      faceValue: { value: "see schedule", snippet: "see schedule", confidence: 0.9 },
    }, "r1");
    expect(row.missingRequired).toContain("faceValue");
  });

  it("drops a key the entity does not have", () => {
    const row = placeRow(life, {
      notAField: { value: 1, snippet: "x", confidence: 0.9 },
    }, "r1");
    expect(valueOf(row, "notAField")).toBeUndefined();
  });

  it("never places an update-only or derived field", () => {
    const entity = {
      ...life,
      fields: [
        { key: "name", label: "Name", kind: "string" as const, required: true },
        { key: "notes", label: "Notes", kind: "text" as const, appliesTo: "update" as const },
        { key: "total", label: "Total", kind: "money" as const, writable: false as const },
      ],
    };
    const row = placeRow(entity, {
      name: { value: "A", snippet: "A", confidence: 1 },
      notes: { value: "hi", snippet: "hi", confidence: 1 },
      total: { value: 5, snippet: "5", confidence: 1 },
    }, "r1");
    expect(row.values.map((v) => v.key)).toEqual(["name"]);
  });

  it("flags a number outside a declared range", () => {
    const entity = {
      ...life,
      fields: [{ key: "pct", label: "Pct", kind: "percent" as const, range: { min: 0, max: 100 } }],
    };
    const row = placeRow(entity, { pct: { value: "140", snippet: "140%", confidence: 0.9 } }, "r1");
    expect(valueOf(row, "pct")!.issue).toBe("range");
  });

  it("defaults a missing confidence to zero rather than assuming certainty", () => {
    const row = placeRow(life, { name: { value: "A", snippet: "A" } }, "r1");
    expect(valueOf(row, "name")!.confidence).toBe(0);
  });

  it("a structured ownerRef satisfies its required field instead of blocking the row", () => {
    const row = placeRow(life, {
      name: { value: "Term Life 20", snippet: "Policy: Term Life 20", confidence: 0.95 },
      faceValue: { value: "$500,000", snippet: "Face Amount $500,000", confidence: 0.97 },
      policyType: { value: "term", snippet: "Term", confidence: 0.9 },
      insuredPerson: { value: "client", snippet: "Insured: Michael", confidence: 0.9 },
      ownerRef: { value: { kind: "joint" }, snippet: "Owner: Michael and Sarah", confidence: 0.9 },
    }, "r1");
    expect(row.missingRequired).toEqual([]);
  });
});
