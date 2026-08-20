import type { ReactElement } from "react";
import { loadDebtPaydown } from "@/lib/portal/load-debt-paydown";
import { DebtPaydownWorkspace } from "@/components/portal/debt-paydown-workspace";

export async function DebtPaydownScreen({
  clientId,
  readOnly = false,
}: {
  clientId: string;
  /** Advisor preview: renders and runs the numbers, but never autosaves. */
  readOnly?: boolean;
}): Promise<ReactElement> {
  const dto = await loadDebtPaydown(clientId);
  return <DebtPaydownWorkspace dto={dto} readOnly={readOnly} />;
}
