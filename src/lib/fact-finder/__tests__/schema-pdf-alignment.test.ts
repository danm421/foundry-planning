// src/lib/fact-finder/__tests__/schema-pdf-alignment.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FACT_FINDER_SECTIONS,
  PDF_HOLDINGS_TABLE,
  fixedLabelsOf,
  pdfKeysOf,
  type FFColumn,
} from "../schema";
import frozen from "../__fixtures__/pdf-index-frozen.json";

const FIXTURES = path.join(__dirname, "../__fixtures__");

interface FieldInfo {
  type: string;
  options: string[] | null;
}

async function fieldsOf(file: string): Promise<Map<string, FieldInfo>> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(readFileSync(path.join(FIXTURES, file))));
  const objects = (await doc.getFieldObjects()) ?? {};
  const out = new Map<string, FieldInfo>();
  for (const [name, widgets] of Object.entries(objects)) {
    const first = widgets[0] as { type?: string; items?: Array<{ displayValue?: string }> };
    out.set(name, {
      type: String(first.type ?? ""),
      options: first.items ? first.items.map((i) => String(i.displayValue ?? "")) : null,
    });
  }
  return out;
}

/** Every field the schema says the PDF has, with the column it carries. */
function expectedFields(): Map<string, FFColumn> {
  const out = new Map<string, FFColumn>();
  for (const s of FACT_FINDER_SECTIONS) {
    if (s.layout === "notes") {
      out.set(s.id, s.columns[0]);
      continue;
    }
    for (const col of s.columns) {
      if (col.pdfIndex === undefined) continue;
      for (const key of pdfKeysOf(s)) {
        if (s.layout === "transposed") {
          for (let c = 1; c <= (s.entries ?? 0); c++) out.set(`${key}_r${col.pdfIndex}_c${c}`, col);
        } else {
          const rows = s.layout === "fixedRows" ? fixedLabelsOf(s).length : (s.pdfRows ?? 0);
          for (let r = 1; r <= rows; r++) out.set(`${key}_r${r}_c${col.pdfIndex}`, col);
        }
      }
    }
  }
  for (const col of PDF_HOLDINGS_TABLE.columns) {
    for (let r = 1; r <= PDF_HOLDINGS_TABLE.pdfRows; r++) {
      out.set(`${PDF_HOLDINGS_TABLE.pdfKey}_r${r}_c${col.pdfIndex}`, col as FFColumn);
    }
  }
  return out;
}

const PDF_TYPE: Record<string, string> = { choice: "combobox", check: "checkbox" };

describe("schema ↔ blank PDF", () => {
  it("has exactly the fields the schema declares", async () => {
    const actual = await fieldsOf("fact-finder-blank.pdf");
    const expected = expectedFields();
    const missing = [...expected.keys()].filter((n) => !actual.has(n));
    const extra = [...actual.keys()].filter((n) => !expected.has(n));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("gives every field the schema's type and option list", async () => {
    const actual = await fieldsOf("fact-finder-blank.pdf");
    for (const [name, col] of expectedFields()) {
      const field = actual.get(name)!;
      expect(field.type, name).toBe(PDF_TYPE[col.kind] ?? "text");
      if (col.kind === "choice") expect(field.options, name).toEqual([" ", ...(col.options ?? [])]);
    }
  });
});

describe("pdfIndex is append-only", () => {
  it("never renumbers or drops a column a printed copy already carries", () => {
    const current: Record<string, number> = {};
    for (const s of FACT_FINDER_SECTIONS) {
      for (const c of s.columns) if (c.pdfIndex !== undefined) current[`${s.id}.${c.id}`] = c.pdfIndex;
    }
    for (const [key, index] of Object.entries(frozen as Record<string, number>)) {
      expect(current[key], key).toBe(index);
    }
  });
});
