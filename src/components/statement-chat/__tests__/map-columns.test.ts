import { describe, it, expect } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { columnsForEntity, overflowFields, MAX_COLUMNS } from "../map-columns";

const life = findEntity("life_insurance_policy")!;

describe("columnsForEntity", () => {
  it("takes the header from the advisor-facing label, not the payload key", () => {
    const face = columnsForEntity(life).find((c) => c.key === "faceValue");
    expect(face?.header).toBe("Death benefit");
  });

  it("carries the field's kind through so money and rates format correctly", () => {
    expect(columnsForEntity(life).find((c) => c.key === "faceValue")?.kind).toBe("money");
  });

  // Task 12 review, Important 4: `life_insurance_policy` already declares its
  // five required fields as `fields[0..4]`, so deleting the reordering in
  // `map-columns.ts` and returning the fields in DECLARATION order still
  // passes the old version of this test — it never exercised the reorder. A
  // fixture with its required fields declared LATE actually forces it.
  it("puts required fields first even when the map declares them late", () => {
    const entity = {
      ...life,
      fields: [
        { key: "notes", label: "Notes", kind: "string" as const },
        { key: "memo", label: "Memo", kind: "string" as const },
        { key: "name", label: "Name", kind: "string" as const, required: true },
        { key: "amount", label: "Amount", kind: "money" as const, required: true },
      ],
    };
    expect(columnsForEntity(entity).map((c) => c.key)).toEqual(["name", "amount", "notes", "memo"]);
  });

  it("never offers a column for a field the create path refuses", () => {
    const entity = {
      ...life,
      fields: [
        { key: "name", label: "Name", kind: "string" as const, required: true },
        { key: "notes", label: "Notes", kind: "text" as const, appliesTo: "update" as const },
      ],
    };
    expect(columnsForEntity(entity).map((c) => c.key)).toEqual(["name"]);
  });

  it("caps the column count so a 22-field entity stays readable", () => {
    expect(columnsForEntity(life).length).toBeLessThanOrEqual(MAX_COLUMNS);
  });

  it("maps a text field to the string column kind the table understands", () => {
    const entity = { ...life, fields: [{ key: "notes2", label: "Notes", kind: "text" as const }] };
    expect(columnsForEntity(entity)[0].kind).toBe("string");
  });

  // Task 12 review, Ruling 18: `ownerRef` (`kind: "object"`) is required,
  // sits in column index 3 of the real `life_insurance_policy` map, and
  // `formatValue`'s `String(value)` fallback renders a plain object as
  // "[object Object]". A discriminated union's `kind` field is its own
  // readable summary, so that — not "[object Object]", and not "—" for a
  // value that IS present — is what a column built for one has to show.
  it("gives an object field an honest summary instead of rendering it as [object Object]", () => {
    const entity = { ...life, fields: [{ key: "ownerRef", label: "Owner", kind: "object" as const }] };
    const column = columnsForEntity(entity)[0];
    const rendered = column.render?.(
      { __rowId: "r1", ownerRef: { kind: "family", id: "fm-1" } },
      { isCommitted: false },
    );
    expect(rendered).toBe("family");
  });

  it("summarizes an array field by count rather than stringifying it", () => {
    const entity = { ...life, fields: [{ key: "schedule", label: "Schedule", kind: "array" as const }] };
    const column = columnsForEntity(entity)[0];
    const rendered = column.render?.(
      { __rowId: "r1", schedule: [1, 2, 3] },
      { isCommitted: false },
    );
    expect(rendered).toBe("3 items");
  });
});

describe("overflowFields", () => {
  it("is empty once every askable field fits under the cap", () => {
    const entity = { ...life, fields: life.fields.slice(0, 3) };
    expect(overflowFields(entity)).toEqual([]);
  });

  it("carries every askable field past the cap, in the same required-first order columnsForEntity uses", () => {
    const overflow = overflowFields(life);
    expect(overflow.length).toBe(life.fields.filter((f) => f.appliesTo !== "update" && f.writable !== false).length - MAX_COLUMNS);
    expect(overflow.every((f) => !f.required)).toBe(true);
  });
});
