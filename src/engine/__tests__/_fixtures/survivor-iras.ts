// Plans whose IRA changes hands at the first death, so the survivor years route
// its required withdrawals by the WORKING owners the death event wrote — not by
// the owners the plan was entered with. Shared by the engine's
// `distribution-detail.test.ts` and the Distributions view's builder tests.
//
// John (1970) dies in 2045 (life expectancy 75); Jane (1972) lives on through
// the plan's end in 2055, so 2046–2055 are survivor years.
import { baseClient, buildClientData, sampleAccounts, sampleFamilyMembers } from "../fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";
import type { Account, BeneficiaryRef, ClientData, FamilyMember } from "../../types";

export const FIRST_DEATH_YEAR = 2045;

const janeOwns = [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }];

/** Without a default checking account the engine skips the surplus phase. */
const checking: Account = {
  id: "acct-checking",
  name: "Joint Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 10_000,
  basis: 10_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const kid: FamilyMember = {
  id: "fm-kid",
  role: "child",
  relationship: "child",
  firstName: "Kid",
  lastName: "Smith",
  dateOfBirth: "2000-01-01",
};

/** A Roth IRA Jane inherited from a parent (born 1965, died 2022). Within ten
 *  years of her age, so it stretches over her life expectancy and pays out —
 *  tax-free — in every survivor year. Its cash is the inherited-Roth half of
 *  `rmdInTotalIncome` (householdRmdTaxFreeCashIn). */
export const JANE_INHERITED_ROTH: Account = {
  id: "acct-inh-roth",
  name: "Jane Inherited Roth",
  category: "retirement",
  subType: "roth_ira",
  titlingType: "jtwros",
  value: 150_000,
  basis: 0,
  growthRate: 0.05,
  rmdEnabled: false,
  owners: janeOwns,
  inheritedDeathYear: 2022,
  inheritedOwnerBirthYear: 1965,
};

export const TRUST_ID = "ngt";

const trustChecking: Account = {
  ...checking,
  id: "acct-trust-checking",
  name: "Trust Checking",
  value: 0,
  basis: 0,
  isDefaultChecking: true,
  owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
};

/** The base fixture's 401(k) as John's fully pre-tax Traditional IRA, left to
 *  `beneficiaries` at his death. */
function accountsWithJohnIra(beneficiaries: BeneficiaryRef[]): Account[] {
  return [
    checking,
    ...sampleAccounts.map((a) =>
      a.id === "acct-401k"
        ? { ...a, name: "John IRA", subType: "traditional_ira", basis: 0, beneficiaries }
        : a,
    ),
    JANE_INHERITED_ROTH,
  ];
}

const survivorClient = { ...baseClient, lifeExpectancy: 75, spouseLifeExpectancy: 95 };

/** John's IRA goes 50% to Jane and 50% to their child: the death event mints
 *  one new account per share (`death-acct-N`), each taking its own RMD. */
export function iraSplitAtFirstDeath(): ClientData {
  return buildClientData({
    client: survivorClient,
    familyMembers: [...sampleFamilyMembers, kid],
    accounts: accountsWithJohnIra([
      { id: "b1", tier: "primary", percentage: 50, familyMemberId: LEGACY_FM_SPOUSE, sortOrder: 0 },
      { id: "b2", tier: "primary", percentage: 50, familyMemberId: kid.id, sortOrder: 1 },
    ]),
  });
}

/** John's IRA goes 100% to a non-grantor trust: the account keeps its id, but
 *  from the next year its RMD is the trust's cash, not the household's. */
export function iraToTrustAtFirstDeath(): ClientData {
  return buildClientData({
    client: survivorClient,
    accounts: [
      ...accountsWithJohnIra([
        { id: "b1", tier: "primary", percentage: 100, entityIdRef: TRUST_ID, sortOrder: 0 },
      ]),
      trustChecking,
    ],
    entities: [{ id: TRUST_ID, name: "NGT", includeInPortfolio: false, isGrantor: false }],
  });
}
