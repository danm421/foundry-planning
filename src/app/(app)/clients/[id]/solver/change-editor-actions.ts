"use server";

// Server action behind the Solver's Changes tab: clicking a change opens that
// row's own Details-page editor in place. The Solver page never loads a
// Details view's data, so the host fetches it here, on click, through the SAME
// loader the Details page renders from — the editor opens off the same rows.
//
// Read-only. Auth follows the scenario routes (the promote route:
// `requireClientEditAccess` for the owning firm + edit permission, then
// `assertScenarioRouteScope` for "this scenario is this client's", then a
// base-case refusal). The editors it opens write through the scenario writer,
// so a caller who can't write, or a base "scenario", gets nothing.

import { z } from "zod";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";
import type { DetailsEditorPage } from "@/lib/scenario/change-editor-target";
import { loadIncomeExpensesViewProps } from "@/app/(app)/clients/[id]/details/income-expenses/load-view-props";
import { loadNetWorthViewProps } from "@/app/(app)/clients/[id]/details/net-worth/load-view-props";
import { loadTechniquesViewProps } from "@/app/(app)/clients/[id]/details/techniques/load-view-props";
import { loadFamilyViewProps } from "@/app/(app)/clients/[id]/details/family/load-view-props";
import { loadWillsViewProps } from "@/app/(app)/clients/[id]/details/wills/load-view-props";
import type { IncomeExpensesViewProps } from "@/components/income-expenses-view";
import type { BalanceSheetViewProps } from "@/components/balance-sheet-view";
import type { TechniquesViewProps } from "@/components/techniques-view";
import type { FamilyViewProps } from "@/components/family-view";
import type { WillsPanelProps } from "@/components/wills-panel";

/**
 * The Details pages the Solver opens in place. Not "assumptions": every focus
 * there comes back "unavailable" (Ruling T4e-assumptions), so the host links
 * straight to the page without a round trip.
 */
export type SolverEditorPage = Exclude<DetailsEditorPage, "assumptions">;

/** One Details view's props — never the page's sibling data (banners, firmId). */
export type ChangeEditorViewProps =
  | { page: "income-expenses"; props: IncomeExpensesViewProps }
  | { page: "net-worth"; props: BalanceSheetViewProps }
  | { page: "techniques"; props: TechniquesViewProps }
  | { page: "family"; props: FamilyViewProps }
  | { page: "wills"; props: WillsPanelProps };

// A server action is a public endpoint: check the shape before any query (a
// non-uuid id would otherwise reach Postgres as a 22P02).
const INPUT = z.object({
  clientId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  page: z.enum(["income-expenses", "net-worth", "techniques", "family", "wills"]),
});

/**
 * Load one Details view's props for `clientId` inside scenario `scenarioId`.
 * Throws on bad input, no edit access, a scenario that isn't this client's, the
 * base case, or a plan with no base case; the host shows any failure inline.
 */
export async function loadChangeEditorProps(
  clientId: string,
  scenarioId: string,
  page: SolverEditorPage,
): Promise<ChangeEditorViewProps> {
  const input = INPUT.parse({ clientId, scenarioId, page });

  const { firmId } = await requireClientEditAccess(input.clientId);
  const scope = await assertScenarioRouteScope(input.clientId, input.scenarioId, firmId);
  if (scope.kind === "miss") throw new Error("Scenario not found");
  if (scope.scenario.isBaseCase) throw new Error("The base case has no changes to edit");

  switch (input.page) {
    case "income-expenses":
      return { page: input.page, props: okProps(await loadIncomeExpensesViewProps(clientId, scenarioId)) };
    case "net-worth":
      return { page: input.page, props: okProps(await loadNetWorthViewProps(clientId, scenarioId)) };
    case "techniques":
      return { page: input.page, props: okProps(await loadTechniquesViewProps(clientId, scenarioId)) };
    case "family":
      return { page: input.page, props: (await loadFamilyViewProps(clientId, scenarioId)).props };
    case "wills":
      return { page: input.page, props: okProps(await loadWillsViewProps(clientId, scenarioId)) };
  }
}

/** The view props of a loader's "ok" result; any early return is a failure here. */
function okProps<P>(result: { status: "ok"; props: P } | { status: string }): P {
  if (result.status !== "ok" || !("props" in result)) {
    throw new Error("This plan has no base case");
  }
  return result.props;
}
