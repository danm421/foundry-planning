// src/lib/household-map/__tests__/scenario-fields.test.ts
//
// The shared prune every Household Map scenario payload runs through. Moved
// here from `life-expectancy-write.test.ts` when the rule stopped being
// duplicated per-writer; `flow-write.test.ts` covers the same helper through
// `buildFlowScenarioFields` with the flow strip set applied.

import { describe, it, expect } from "vitest";
import { pruneScenarioFields } from "../scenario-fields";

const CLIENT_FIELDS = {
  firstName: "Dan",
  lastName: "Cooper",
  dateOfBirth: "1972-03-04",
  lifeExpectancy: 92,
  spouseName: "Amy",
  spouseDob: "1974-06-01",
  spouseLifeExpectancy: 90,
  planEndAge: 92,
  filingStatus: "married_joint",
  retirementAge: 62,
};

describe("pruneScenarioFields", () => {
  // The engine's loaders emit `x ?? undefined` for every absent optional
  // column, while the base tree those get diffed against carries `null`.
  // `valuesEqual(null, undefined)` is false, so an explicit `undefined` diffs as
  // a change and then vanishes in `JSON.stringify` — writing "no value" over a
  // real base value.
  it("drops undefined keys", () => {
    const out = pruneScenarioFields({
      lifeExpectancy: 92,
      spouseLifeExpectancy: undefined,
    });
    expect(out).not.toHaveProperty("spouseLifeExpectancy");
    expect(out).toEqual({ lifeExpectancy: 92 });
  });

  // null is a REAL stored value ("this person has no spouse LE on record"), not
  // an absent one — pruning it would silently stop the scenario overriding it.
  it("keeps null, and keeps falsy values that are not undefined", () => {
    const out = pruneScenarioFields({
      spouseLifeExpectancy: null,
      retirementMonth: 0,
      isSelfEmployment: false,
      spouseName: "",
    });
    expect(out).toEqual({
      spouseLifeExpectancy: null,
      retirementMonth: 0,
      isSelfEmployment: false,
      spouseName: "",
    });
  });

  it("survives the JSON round-trip the fetch performs, losing no key", () => {
    const out = pruneScenarioFields({ ...CLIENT_FIELDS, spouseRetirementAge: undefined });
    const overTheWire = JSON.parse(JSON.stringify(out));
    expect(Object.keys(overTheWire).sort()).toEqual(Object.keys(out).sort());
  });

  // The strip set is a PARAMETER, not a shared constant: the singletons pass
  // none, so a `client` row that one day gains an `id` keeps it rather than
  // silently inheriting the flow rows' strip.
  it("strips only the keys the caller names, and nothing by default", () => {
    const row = { id: "inc-1", name: "Salary", scheduleOverrides: [{ year: 2030, amount: 1 }] };

    expect(pruneScenarioFields(row)).toEqual(row);
    expect(pruneScenarioFields(row, new Set(["id", "scheduleOverrides"]))).toEqual({
      name: "Salary",
    });
  });
});
