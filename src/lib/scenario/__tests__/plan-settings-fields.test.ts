import { describe, it, expect } from "vitest";
import {
  formPatchToScenarioFields,
  planSettingsEngineToColumns,
} from "../plan-settings-fields";

describe("formPatchToScenarioFields", () => {
  it("renames DB keys to engine keys and coerces decimal strings", () => {
    expect(formPatchToScenarioFields({ outOfHouseholdDniRate: "0.37", flatStateRate: "0.05" },
      { priorTaxableGifts: { client: 0, spouse: 0 } })).toEqual({
      planSettings: { outOfHouseholdRate: 0.37, flatStateRate: 0.05 }, client: {} });
  });

  it("folds one prior-taxable-gifts side into the engine object", () => {
    expect(formPatchToScenarioFields({ priorTaxableGiftsSpouse: "12000" },
      { priorTaxableGifts: { client: 5000, spouse: 0 } }).planSettings)
      .toEqual({ priorTaxableGifts: { client: 5000, spouse: 12000 } });
  });

  it("routes workplace coverage to the client singleton", () => {
    expect(formPatchToScenarioFields({ coveredByWorkplacePlan: "yes" },
      { priorTaxableGifts: { client: 0, spouse: 0 } })).toEqual({
      planSettings: {}, client: { coveredByWorkplacePlan: "yes" } });
  });

  it("keeps null and non-numeric strings as-is", () => {
    expect(formPatchToScenarioFields({ pvDiscountRate: null, residenceState: "CA", taxEngineMode: "bracket" },
      { priorTaxableGifts: { client: 0, spouse: 0 } }).planSettings)
      .toEqual({ pvDiscountRate: null, residenceState: "CA", taxEngineMode: "bracket" });
  });

  it("never coerces a string key, even when its value looks numeric", () => {
    expect(formPatchToScenarioFields({ surplusSaveAccountId: "12345", defaultGrowthTaxable: "0.07" },
      { priorTaxableGifts: { client: 0, spouse: 0 } }).planSettings)
      .toEqual({ surplusSaveAccountId: "12345", defaultGrowthTaxable: 0.07 });
  });
});

describe("planSettingsEngineToColumns", () => {
  it("maps engine keys back to columns for promotion", () => {
    expect(planSettingsEngineToColumns({ outOfHouseholdRate: 0.37,
      priorTaxableGifts: { client: 1, spouse: 2 }, flatStateRate: 0.05 })).toEqual({
      outOfHouseholdDniRate: 0.37, priorTaxableGiftsClient: 1, priorTaxableGiftsSpouse: 2, flatStateRate: 0.05 });
  });

  // A Forge `propose_changes` can store `priorTaxableGifts: null`; reading
  // `.client` off it threw, and promote returned 500.
  it.each([null, undefined])("skips a %s priorTaxableGifts instead of throwing", (value) => {
    expect(planSettingsEngineToColumns({ priorTaxableGifts: value, flatStateRate: 0.05 })).toEqual({
      flatStateRate: 0.05,
    });
  });
});
