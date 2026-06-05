// src/lib/quick-start/bootstrap.ts
// Pure serializable shape the server page hands to the client wizard.
import type { ModelPortfolioOption } from "@/lib/cma/model-portfolio-options";
import type { GrowthCategorySource, FlatGrowthSource } from "./types";

export interface SsSeed {
  id: string;
  monthlyBenefit: number | null;
  claimingAge: number | null;
}

export interface QsBootstrap {
  clientId: string;
  ctxInput: {
    client: {
      dateOfBirth: string;
      retirementAge: number;
      planEndAge: number;
      spouseDob: string | null;
      spouseRetirementAge: number | null;
    };
    planStartYear: number;
    planEndYear: number;
    clientFirstName: string;
    spouseFirstName: string | null;
    hasSpouse: boolean;
  };
  residenceState: string | null;
  expenseStubs: { currentId: string | null; retirementId: string | null };
  ssStubs: {
    client: SsSeed | null;
    spouse: SsSeed | null;
  };
  familyMemberIds: { client: string | null; spouse: string | null };
  defaultGrowth: {
    taxable: number;
    cash: number;
    retirement: number;
    realEstate: number;
    lifeInsurance: number;
    inflation: number;
  };
  /** Firm model portfolios (with blended returns) offered in the growth picker. */
  modelPortfolios: ModelPortfolioOption[];
  /** Saved growth source per category, used to seed the picker on re-entry. */
  growthSource: {
    taxable: { source: GrowthCategorySource; portfolioId: string | null };
    cash: { source: GrowthCategorySource; portfolioId: string | null };
    retirement: { source: GrowthCategorySource; portfolioId: string | null };
    realEstate: FlatGrowthSource;
    lifeInsurance: FlatGrowthSource;
  };
}
