import { describe, expect, it } from "vitest";
import { applyFinalDeath } from "../final-death";
import type { DeathEventInput } from "../shared";
import type {
  Account,
  FamilyMember,
  PlanSettings,
  Relocation,
} from "../../types";
import { LEGACY_FM_CLIENT } from "../../ownership";

// ---------------------------------------------------------------------------
// Task 3 — death-year residence state for estate/inheritance tax.
//
// Invariant: a relocation that PRECEDES the modeled death re-states the estate
// under the destination state. Base state CA has NO state estate tax (not in
// the estate-tax jurisdictions → fallback flat rate 0 → $0). Destination WA
// has a graduated estate tax with a $3,000,000 exclusion (data.ts:226). So an
// estate above the WA exclusion is taxed > $0 when the move year ≤ death year,
// and $0 (CA) when the move year > death year. Verified against:
//   - src/lib/tax/state-estate/data.ts  (WA exemption $3M; CA absent)
//   - src/lib/tax/state-estate/compute.ts (non-estate-tax state → fallback 0)
//   - src/engine/death-event/estate-tax.ts (result field `stateEstateTax`)
// ---------------------------------------------------------------------------

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Client",
  lastName: "Test",
  dateOfBirth: "1970-01-01",
};

const kidA: FamilyMember = {
  id: "kid-a",
  role: "child",
  relationship: "child",
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "2000-01-01",
};

const planSettings = (over: Partial<PlanSettings> = {}): PlanSettings => ({
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  // No tax inflation: keeps the WA $3M exclusion un-projected so the bracket
  // math below is exact (WA is indexed:false anyway, but the BEA stays put too).
  taxInflationRate: 0,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
  ...over,
});

const mkInput = (over: Partial<DeathEventInput>): DeathEventInput => {
  const accounts = over.accounts ?? [];
  const accountBalances: Record<string, number> = { ...(over.accountBalances ?? {}) };
  const basisMap: Record<string, number> = { ...(over.basisMap ?? {}) };
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  const callerFms = over.familyMembers ?? [];
  const principal = callerFms.some((f) => f.id === LEGACY_FM_CLIENT)
    ? []
    : [clientFm];
  const { familyMembers: _fm, ...rest } = over;
  return {
    year: 2052,
    deceased: "client",
    survivor: "client",
    will: null,
    accounts,
    accountBalances,
    basisMap,
    incomes: [],
    liabilities: [],
    familyMembers: [...principal, ...callerFms],
    externalBeneficiaries: [],
    entities: [],
    planSettings: planSettings(),
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
    ...rest,
  };
};

// $5M brokerage owned outright by the (single) decedent. Whole value is the
// taxable estate (no marital deduction at single final death). Federal estate
// tax is $0 (estate << ~$15M BEA), isolating the STATE estate tax.
const brokerage = (): Account => ({
  id: "brok",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  titlingType: "jtwros",
  value: 5_000_000,
  basis: 2_000_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
});

// Expected WA estate tax on a $5M estate ($2M WA-taxable over the $3M excl):
//   $3M–$4M @10% = $100,000
//   $4M–$5M @14% = $140,000  →  $240,000
const EXPECTED_WA_TAX = 240_000;

describe("relocation → death-year residence state drives estate tax", () => {
  const deathYear = 2052;

  it("taxes the estate under the destination state when the move precedes death", () => {
    const move: Relocation = {
      id: "reloc-1",
      name: "Move to Washington",
      year: 2040, // 2040 ≤ 2052 → WA applies at death
      destinationState: "WA",
    };
    const input = mkInput({
      year: deathYear,
      accounts: [brokerage()],
      familyMembers: [kidA],
      planSettings: planSettings({ residenceState: "CA" }),
      relocations: [move],
    });

    const result = applyFinalDeath(input);

    // Re-stated under WA: graduated tax on the $2M over the $3M exclusion.
    expect(result.estateTax.residenceState).toBe("WA");
    expect(result.estateTax.stateEstateTax).toBeCloseTo(EXPECTED_WA_TAX, 0);
    // Federal tax stays $0 (estate is far below the federal BEA).
    expect(result.estateTax.federalEstateTax).toBeCloseTo(0, 0);
  });

  it("keeps the base state (CA → $0) when the move happens AFTER death", () => {
    const move: Relocation = {
      id: "reloc-1",
      name: "Move to Washington",
      year: 2060, // 2060 > 2052 → relocation not yet in effect at death
      destinationState: "WA",
    };
    const input = mkInput({
      year: deathYear,
      accounts: [brokerage()],
      familyMembers: [kidA],
      planSettings: planSettings({ residenceState: "CA" }),
      relocations: [move],
    });

    const result = applyFinalDeath(input);

    // Still CA: not an estate-tax jurisdiction → $0 (fallback rate 0).
    expect(result.estateTax.residenceState).toBe("CA");
    expect(result.estateTax.stateEstateTax).toBeCloseTo(0, 0);
    expect(result.estateTax.federalEstateTax).toBeCloseTo(0, 0);
  });

  it("is a no-op for relocation-free plans (base CA → $0)", () => {
    const input = mkInput({
      year: deathYear,
      accounts: [brokerage()],
      familyMembers: [kidA],
      planSettings: planSettings({ residenceState: "CA" }),
      // no `relocations` field at all
    });

    const result = applyFinalDeath(input);

    expect(result.estateTax.residenceState).toBe("CA");
    expect(result.estateTax.stateEstateTax).toBeCloseTo(0, 0);
  });
});
