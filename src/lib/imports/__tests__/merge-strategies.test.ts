import { describe, expect, it } from "vitest";
import { applyMerge, type FieldMap } from "../merge-strategies";

interface SampleRow {
  name: string;
  notes: string | null;
  amount: number | null;
  flag: boolean;
}

describe("applyMerge", () => {
  const baseExisting: SampleRow = {
    name: "Existing Name",
    notes: "existing notes",
    amount: 100,
    flag: false,
  };

  it('"replace" overwrites with any defined value (including null and empty string)', () => {
    const map: FieldMap<SampleRow> = { name: "replace", notes: "replace", amount: "replace" };
    const result = applyMerge(baseExisting, { name: "New", notes: null, amount: 0 }, map);
    expect(result.name).toBe("New");
    expect(result.notes).toBeNull();
    expect(result.amount).toBe(0);
    expect(result.flag).toBe(false);
  });

  it('"replace" leaves existing alone when the incoming value is undefined', () => {
    const map: FieldMap<SampleRow> = { name: "replace" };
    const result = applyMerge(baseExisting, {}, map);
    expect(result.name).toBe("Existing Name");
  });

  it('"replace-if-non-null" overwrites only when the incoming value is meaningful', () => {
    const map: FieldMap<SampleRow> = {
      name: "replace-if-non-null",
      notes: "replace-if-non-null",
      amount: "replace-if-non-null",
    };
    const result = applyMerge(
      baseExisting,
      { name: "New Name", notes: null, amount: undefined },
      map,
    );
    expect(result.name).toBe("New Name");
    expect(result.notes).toBe("existing notes");
    expect(result.amount).toBe(100);
  });

  it('"replace-if-non-null" treats empty string as a no-op', () => {
    const map: FieldMap<SampleRow> = { notes: "replace-if-non-null" };
    const result = applyMerge(baseExisting, { notes: "" }, map);
    expect(result.notes).toBe("existing notes");
  });

  it('"replace-if-non-null" preserves false and zero (only null / undefined / empty string skip)', () => {
    const map: FieldMap<SampleRow> = {
      flag: "replace-if-non-null",
      amount: "replace-if-non-null",
    };
    const result = applyMerge(
      { ...baseExisting, flag: true, amount: 999 },
      { flag: false, amount: 0 },
      map,
    );
    expect(result.flag).toBe(false);
    expect(result.amount).toBe(0);
  });

  it('"keep-existing" never overwrites, even when the incoming value is set', () => {
    const map: FieldMap<SampleRow> = { name: "keep-existing", notes: "keep-existing" };
    const result = applyMerge(
      baseExisting,
      { name: "Should Not Win", notes: "Should Not Win Either" },
      map,
    );
    expect(result.name).toBe("Existing Name");
    expect(result.notes).toBe("existing notes");
  });

  it("returns a new object rather than mutating the existing one", () => {
    const map: FieldMap<SampleRow> = { name: "replace" };
    const result = applyMerge(baseExisting, { name: "New" }, map);
    expect(result).not.toBe(baseExisting);
    expect(baseExisting.name).toBe("Existing Name");
  });

  it("ignores keys not listed in the field map even when present in incoming", () => {
    const map: FieldMap<SampleRow> = { name: "replace" };
    const result = applyMerge(baseExisting, { name: "New", notes: "Should Be Ignored" }, map);
    expect(result.name).toBe("New");
    expect(result.notes).toBe("existing notes");
  });

  it("composes mixed strategies in the same call", () => {
    const map: FieldMap<SampleRow> = {
      name: "replace",
      notes: "replace-if-non-null",
      amount: "keep-existing",
    };
    const result = applyMerge(
      baseExisting,
      { name: "New Name", notes: null, amount: 999 },
      map,
    );
    expect(result.name).toBe("New Name");
    expect(result.notes).toBe("existing notes");
    expect(result.amount).toBe(100);
  });
});
