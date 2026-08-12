// Which scenario a plan-story write may key a row on.
//
// `plan_story_chapters.scenario_id` is text with NO foreign key — deliberately,
// so a base-only story needs no synthetic scenario row (schema.ts). That leaves
// the column unable to reject anything, and both PATCH writers are upserts
// (repo.ts), so without this check every distinct string an edit-authorized
// caller sends would create its own row: invisible to GET, which filters by
// scenarioId, and never cleaned up. This is the only barrier there is.
//
// Callers must already have authorized `clientId`; the lookup is scoped to it,
// so a scenario under another client reads as absent rather than as forbidden.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";

export type StoryScenarioScope =
  | { ok: true; scenarioId: string }
  | { ok: false; status: 400 | 404; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a request's raw `scenarioId` into one a story row may use: the
 * literal "base", or a live scenario this client owns.
 *
 * A snapshot ref is refused rather than resolved. `loadStoryContext` degrades
 * one to a proposal with no strategies and no proposed-confidence figure —
 * `getOrComputeMonteCarlo` cannot key a frozen tree — so a story generated
 * against it would tell the client there is a recommendation and then have
 * nothing to recommend. Refusing it here also keeps an advisor from
 * hand-authoring a chapter under a key that generation can never fill.
 */
export async function resolveStoryScenarioId(
  clientId: string,
  raw: string | null | undefined,
): Promise<StoryScenarioScope> {
  if (raw == null || raw === "base") return { ok: true, scenarioId: "base" };
  if (raw.startsWith("snap:")) {
    return {
      ok: false,
      status: 400,
      error: "A snapshot cannot be used as a plan story scenario",
    };
  }
  // `scenarios.id` is a uuid column, so a malformed value would reach Postgres
  // as `22P02 invalid input syntax` and surface as a 500 rather than a refusal.
  if (!UUID_RE.test(raw)) {
    return { ok: false, status: 400, error: "Invalid scenarioId" };
  }

  const [row] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.id, raw), eq(scenarios.clientId, clientId)));
  if (!row) return { ok: false, status: 404, error: "Scenario not found" };
  return { ok: true, scenarioId: raw };
}
