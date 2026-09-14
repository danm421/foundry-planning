import { describe, it, expect } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { columnsForEntity, MAX_COLUMNS } from "../map-columns";

const life = findEntity("life_insurance_policy")!;

describe("columnsForEntity", () => {
  it("takes the header from the advisor-facing label, not the payload key", () => {
    const face = columnsForEntity(life).find((c) => c.key === "faceValue");
    expect(face?.header).toBe("Death benefit");
  });

  it("carries the field's kind through so money and rates format correctly", () => {
    expect(columnsForEntity(life).find((c) => c.key === "faceValue")?.kind).toBe("money");
  });

  it("puts required fields first so an incomplete row reads at a glance", () => {
    const columns = columnsForEntity(life);
    const firstOptional = columns.findIndex(
      (c) => !life.fields.find((f) => f.key === c.key)?.required,
    );
    const lastRequired = columns.map((c) =>
      Boolean(life.fields.find((f) => f.key === c.key)?.required),
    ).lastIndexOf(true);
    expect(lastRequired).toBeLessThan(firstOptional === -1 ? Infinity : firstOptional);
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
});
