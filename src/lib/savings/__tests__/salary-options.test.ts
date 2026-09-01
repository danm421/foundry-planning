import { describe, it, expect } from "vitest";
import { toSalaryOptions } from "../salary-options";

const OWNER_NAMES = { clientName: "Harold Mueller", spouseName: "Rhonda Mueller" };

function income(
  overrides: Partial<{
    id: string;
    type: string;
    name: string;
    owner: string;
    ownerEntityId: string | null;
  }> = {}
) {
  return {
    id: "inc-1",
    type: "salary",
    name: "Base Salary",
    owner: "client",
    ownerEntityId: null,
    ...overrides,
  };
}

describe("toSalaryOptions", () => {
  describe("label branches", () => {
    const CASES = [
      {
        name: "client-owned salary → the client's first name",
        owner: "client",
        ownerNames: OWNER_NAMES,
        expected: "Harold",
      },
      {
        name: "spouse-owned salary → the spouse's first name",
        owner: "spouse",
        ownerNames: OWNER_NAMES,
        expected: "Rhonda",
      },
      {
        name: 'joint-owned salary → "Joint", never a person\'s name',
        owner: "joint",
        ownerNames: OWNER_NAMES,
        expected: "Joint",
      },
      {
        name: 'missing ownerNames → the generic "Client"/"Spouse" fallback',
        owner: "client",
        ownerNames: undefined,
        expected: "Client",
      },
    ] as const;

    it.each(CASES)("$name", ({ owner, ownerNames, expected }) => {
      const options = toSalaryOptions([income({ owner })], ownerNames);
      expect(options).toEqual([{ id: "inc-1", name: "Base Salary", ownerLabel: expected }]);
    });

    it('a joint income never reads as "client" or "spouse", even by accident', () => {
      // A joint-owned salary is labeled "Joint" unconditionally — the branch
      // must be checked BEFORE falling through to the client/spouse ternary,
      // not merely produce the right string by coincidence of test data.
      const options = toSalaryOptions([income({ owner: "joint" })], undefined);
      expect(options[0].ownerLabel).toBe("Joint");
    });

    it("falls back to Spouse when the spouse's name is an empty string, not just missing", () => {
      // `"".split(" ")[0]` is `""`, and `"" ?? null` never substitutes — a
      // plain `??` fallback would render the row as "Base Salary — " instead
      // of falling back to "Spouse". Regression for that exact bug.
      const options = toSalaryOptions(
        [income({ owner: "spouse" })],
        { clientName: "Harold Mueller", spouseName: "" }
      );
      expect(options).toEqual([{ id: "inc-1", name: "Base Salary", ownerLabel: "Spouse" }]);
    });

    it("takes only the first name out of a full name", () => {
      const options = toSalaryOptions([income({ owner: "client" })], OWNER_NAMES);
      expect(options[0].ownerLabel).toBe("Harold");
    });
  });

  describe("filters", () => {
    it("drops income whose type is not exactly 'salary'", () => {
      // The engine's salary base has always meant `type === "salary"` —
      // widening this (e.g. to include "business" or "deferred") would
      // silently change what an EXISTING rule's "% of salary" resolves
      // against.
      const options = toSalaryOptions(
        [
          income({ id: "inc-biz", type: "business" }),
          income({ id: "inc-def", type: "deferred" }),
          income({ id: "inc-sal", type: "salary" }),
        ],
        OWNER_NAMES
      );
      expect(options.map((o) => o.id)).toEqual(["inc-sal"]);
    });

    it("drops salary income owned by an entity (a trust/business)", () => {
      // A trust's salary can't ground a household deferral — the same
      // exclusion the engine applies when resolving `salaryBasis`.
      const options = toSalaryOptions(
        [
          income({ id: "inc-trust", ownerEntityId: "ent-1" }),
          income({ id: "inc-personal", ownerEntityId: null }),
        ],
        OWNER_NAMES
      );
      expect(options.map((o) => o.id)).toEqual(["inc-personal"]);
    });

    it("keeps a salary with ownerEntityId left undefined (not every producer sets it)", () => {
      const options = toSalaryOptions(
        [{ id: "inc-1", type: "salary", name: "Base Salary", owner: "client" }],
        OWNER_NAMES
      );
      expect(options).toEqual([{ id: "inc-1", name: "Base Salary", ownerLabel: "Harold" }]);
    });
  });

  it("keeps only id/name/ownerLabel, dropping every other income field", () => {
    const options = toSalaryOptions(
      [
        {
          id: "inc-1",
          type: "salary",
          name: "Base Salary",
          owner: "client",
          ownerEntityId: null,
          annualAmount: "150000",
          startYear: 2025,
        } as never,
      ],
      OWNER_NAMES
    );
    expect(options).toEqual([{ id: "inc-1", name: "Base Salary", ownerLabel: "Harold" }]);
  });

  it("returns an empty list for an empty plan", () => {
    expect(toSalaryOptions([], OWNER_NAMES)).toEqual([]);
  });
});
