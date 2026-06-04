"use client";
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
  ssStubs: { client: string | null; spouse: string | null };
  familyMemberIds: { client: string | null; spouse: string | null };
  defaultGrowth: {
    taxable: number;
    cash: number;
    retirement: number;
    realEstate: number;
    lifeInsurance: number;
    inflation: number;
  };
}

export function QuickStartWizard({ bootstrap }: { bootstrap: QsBootstrap }) {
  return <div data-testid="qs-wizard">Quick Start for {bootstrap.clientId}</div>;
}
