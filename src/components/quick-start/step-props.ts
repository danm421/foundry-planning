// src/components/quick-start/step-props.ts
import type { QsContext } from "@/lib/quick-start/derive";
import type { QsBootstrap } from "@/lib/quick-start/bootstrap";

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
  setCreatedAccounts: (accounts: CreatedAccount[]) => void;
}

export interface QsSavingsStepProps extends QsStepProps {
  createdAccounts: CreatedAccount[];
}
