// Early-withdrawal penalty presentation helpers shared by the Income Tax
// Federal and Other-Taxes drill view-models. The penalty is zero-suppressed:
// it only appears (as a chart series / table column) in years with a pre-59½
// gap-fill draw, so the component lists/stacks still sum to the Other total.

import type { ProjectionYear } from "@/engine/types";
import { dataLight } from "@/brand";

type TaxFlow = NonNullable<ProjectionYear["taxResult"]>["flow"];

/** Chart-stack definition for the early-withdrawal penalty series. */
export const PENALTY_STACK = {
  key: "earlyWithdrawalPenalty",
  label: "Early Withdrawal Penalty",
  color: dataLight.pink,
  pick: (f: TaxFlow | undefined) => f?.earlyWithdrawalPenalty ?? 0,
};

/** True when any visible year carries an early-withdrawal penalty. */
export function hasPenaltyYear(years: ProjectionYear[]): boolean {
  return years.some((y) => (y.taxResult?.flow.earlyWithdrawalPenalty ?? 0) > 0);
}
