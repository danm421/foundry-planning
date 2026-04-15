import type { WithdrawalPriority } from "./types";

export function executeWithdrawals(
  deficit: number,
  strategy: WithdrawalPriority[],
  accountBalances: Record<string, number>,
  year: number
): Record<string, number> {
  // TODO: Implement in Phase 2
  return {};
}
