// src/components/quick-start/step-props.ts
import type { QsContext } from "@/lib/quick-start/derive";
import type { QsBootstrap } from "@/lib/quick-start/bootstrap";
import type { LiftedList } from "@/lib/quick-start/use-lifted-list";
import type { IncomeRow } from "@/lib/quick-start/income-save";
import type { AccountRow } from "@/lib/quick-start/account-save";
import type { InsuranceRow } from "@/lib/quick-start/insurance-save";

/** An account created during the Accounts step, forwarded to the Savings step. */
export interface CreatedAccount {
  id: string;
  category: string;
  subType: string;
  name: string;
}

export interface QsStepProps {
  ctx: QsContext;
  bootstrap: QsBootstrap;
  busy: boolean;
  /** Called during render with the step's save fn; the chrome's Next button runs it. */
  registerSave: (fn: () => Promise<void>) => void;
}

export interface QsAccountsStepProps extends QsStepProps {
  list: LiftedList<AccountRow>;
  setCreatedAccounts: (accounts: CreatedAccount[]) => void;
}

export interface QsSavingsStepProps extends QsStepProps {
  createdAccounts: CreatedAccount[];
}

export interface QsIncomeStepProps extends QsStepProps {
  list: LiftedList<IncomeRow>;
}

export interface QsInsuranceStepProps extends QsStepProps {
  list: LiftedList<InsuranceRow>;
}
