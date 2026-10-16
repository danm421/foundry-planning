// src/domain/mcp/tools/scenario-writes.ts
//
// Keeping a what-if. save_what_if_as_scenario turns the same plain changes
// try_what_if ran into a new named scenario, through the Solver's own save
// (src/lib/solver/save-scenario.ts). The base plan and every existing scenario
// are never touched. defineWriteTool gates it: the firm switch, then edit
// access to the household.
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { foundryScenarioUrl } from "@/lib/mcp/foundry-url";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { saveSolverScenario } from "@/lib/solver/save-scenario";
import { MAX_CHANGES } from "@/lib/whatif/caps";
import { WHAT_IF_CHANGE_SCHEMA } from "@/lib/whatif/changes";
import { growthDefaultsFrom, translateChanges } from "@/lib/whatif/translate";
import { defineWriteTool, McpInputError, type McpTool } from "../define-tool";
import { assertScenarioOfClient, storedMonteCarloSeed } from "../whatif-jobs";

export const SAVE_FAILED_MESSAGE =
  "Foundry couldn't save these changes as a scenario. Save it from the Solver in Foundry instead.";

const saveWhatIfAsScenario = defineWriteTool({
  name: "save_what_if_as_scenario",
  title: "Save a what-if as a scenario",
  description:
    "Save a what-if as a new named scenario in Foundry, so the advisor can open it in the Solver, compare it with " +
    "compare_scenarios, or put it in a deck with generate_presentation. Pass the same changes (and the same starting " +
    "scenarioId) you ran with try_what_if — and only after the advisor has seen the result and asked to keep it. " +
    "This creates a new scenario only: the base plan and every existing scenario stay exactly as they are. Needs the " +
    "firm's 'Claude connector changes' setting turned on (a firm admin does this in Settings → Firm) and edit access " +
    "to the household. Returns the new scenarioId and scenarioUrl, a Foundry link that opens the Solver on it.",
  inputSchema: z.object({
    clientId: z
      .string()
      .describe("Planning client id from search_clients (the clientId field, present only when hasPlan is true). NOT a CRM household id."),
    scenarioId: z
      .string()
      .optional()
      .describe("The scenario the what-if started from (list_scenarios), or omit for the base case."),
    name: z.string().trim().min(1).max(60).describe("The new scenario's name, e.g. 'Retire at 62'."),
    changes: z
      .array(WHAT_IF_CHANGE_SCHEMA)
      .min(1)
      .max(MAX_CHANGES)
      .describe("The same changes you ran with try_what_if."),
  }),
  // No `page`: its foundryUrl would open the base case beside scenarioUrl.
  handler: async ({ clientId, scenarioId, name, changes }, { principal, firmId }) => {
    const source = scenarioId ?? "base";
    await assertScenarioOfClient(clientId, source);
    const { effectiveTree, resolutionContext } = await loadEffectiveTree(clientId, firmId, source, {});
    // Refuses any id that isn't in this household's tree, before anything
    // saves. A new account gets the same resolved category growth default the
    // Solver's quick-add gives it, so this save matches one made there.
    const { mutations } = translateChanges(effectiveTree, changes, undefined, {
      growthDefaults: growthDefaultsFrom(resolutionContext),
    });
    // try_what_if's Monte Carlo used the starting scenario's seed; the new
    // scenario keeps it, so its success rate matches what Claude reported.
    const seed = await storedMonteCarloSeed(clientId, source);
    const saved = await saveSolverScenario({
      clientId,
      firmId,
      source,
      name,
      mutations,
      ...(seed !== undefined ? { seed } : {}),
    });
    if (!saved.ok) throw new McpInputError(SAVE_FAILED_MESSAGE);

    // The same row the Solver's save files, so the scenario's history reads the
    // same whichever way it was made. No session here: the advisor is named.
    await recordAudit({
      action: "scenario.create",
      resourceType: "scenario",
      resourceId: saved.scenarioId,
      clientId,
      firmId,
      actorId: principal.userId,
      actorKind: "advisor",
      metadata: { source: "claude", mutationCount: mutations.length },
    });

    return { scenarioId: saved.scenarioId, name, scenarioUrl: foundryScenarioUrl(clientId, saved.scenarioId) };
  },
  auditMetadata: (args, result) => ({ scenarioId: result.scenarioId, changeCount: args.changes.length }),
});

export const scenarioWriteTools: McpTool[] = [saveWhatIfAsScenario];
