// The name a client reads under "Your Plan" — the plan story's page subtitle.
//
// Its own module, and deliberately not part of `load-for-export.ts`:
// `loadPlanStoryInput` takes the label as a PARAMETER so it can never invent
// one, and this is the caller-side half of that split. Also distinct from
// `scenario-scope.ts`, which answers a different question — which scenario a
// WRITE may key a row on.
//
// Why not `labelForRef(ref, scenarioNames)`, the deck's house pattern:
// `scenarioNames` in `render-presentation-pdf.ts` is built only from the refs
// the deck's bundle plan loads, and the story's own `options.scenarioId` never
// enters that plan — `planStoryPage` declares no `requiredScenarioRefs`, so the
// planner only ever sees the deck's top-level ref and the page's override. In
// the ordinary case (the advisor picks the story's scenario and leaves the deck
// override alone) that map has no entry for it, and `labelForRef` falls back to
// `ref.id`. The subtitle on a client's page would be a raw UUID, which is worse
// than the mid-sentence phrase it replaced.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { planStoryProposedRef } from "@/lib/presentations/pages/plan-story/options-schema";
import { labelForRef, resolveScenarioRef } from "@/lib/scenario/presentation-refs";

/** What every other page of the same PDF calls the current plan. Derived from
 *  `labelForRef` rather than retyped, so a base-only story cannot drift into a
 *  second name for the thing its neighbouring pages already name. */
const BASE_LABEL = labelForRef(resolveScenarioRef("base"), new Map());

/** Readable, and true whichever plan it was. Shaped like `labelForRef`'s own
 *  unnamed-snapshot fallback ("Snapshot") rather than like an id. */
const UNNAMED_PROPOSAL = "Proposed Plan";

/**
 * The display name of the plan a story presents, for this client's scenarios
 * only.
 *
 * Scoping: the query carries `clientId` and the picked id is matched in JS
 * against the rows that came back. That is the whole barrier — `scenarioId`
 * arrives as a raw field on the export body, and this string prints on a page
 * handed to a client, so a lookup by id alone would read back the name of any
 * firm's scenario. It is also why the id is not compared in SQL: `scenarios.id`
 * is a `uuid` column, and a `snap:<id>` ref or any malformed string would raise
 * `22P02` there, turning a cosmetic fallback into a 500.
 *
 * An id this client does not own falls back to a generic phrase rather than
 * failing: for a snapshot ref (the only case that gets this far — a foreign
 * uuid fails the export a moment later, when `loadStoryContext` loads its tree)
 * the report still renders correctly, it just cannot name the plan.
 */
export async function loadStoryScenarioLabel(
  clientId: string,
  scenarioId: string,
): Promise<string> {
  // X1: the one spelling of "does this story have a proposal", imported.
  const proposedRef = planStoryProposedRef(scenarioId);
  if (proposedRef === null) return BASE_LABEL;

  const rows = await db
    .select({ id: scenarios.id, name: scenarios.name })
    .from(scenarios)
    .where(eq(scenarios.clientId, clientId));

  return rows.find((r) => r.id === proposedRef)?.name ?? UNNAMED_PROPOSAL;
}
