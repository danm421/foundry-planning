// src/lib/ai/__tests__/with-ai-caller-org-lint.test.ts
//
// withAiCallerOrg (src/lib/ai/resolve.ts) names the org an AI call resolves
// its tenant for when there is no Clerk session: a sanctioned way around
// resolve's "no firm identity => throw" rule. That makes it a compliance gate.
// The org id it takes must come from a verified principal (the connector's
// bearer token, src/lib/mcp/principal.ts), never from a request or the model.
// A doc comment can't hold that line on its own, so this scan does: every
// non-test file under src/ that names it is listed here, with its reason.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const ALLOWED: Record<string, string> = {
  "src/lib/ai/resolve.ts": "defines it",
  "src/lib/presentations/queue-run.ts":
    "renders a deck for aiCallerOrgId, which generate_presentation sets from the verified token's principal.orgId",
  "src/domain/mcp/tools/household-building.ts": "the connector's review: no Clerk session, the verified token's org",
};

const MESSAGE =
  "withAiCallerOrg is a compliance gate: it decides whose Azure OpenAI tenant an AI call runs in when there is no " +
  "Clerk session, bypassing resolve.ts's 'no firm identity => throw' rule. The org id it takes must come from a " +
  "verified principal (the Claude connector's token, src/lib/mcp/principal.ts), never from a request, a query or " +
  "the model. Go through queuePresentationRun, or add the file to ALLOWED in this test, with the verified principal " +
  "it reads from, in a diff a reviewer can see.";

const isTestFile = (rel: string) => rel.includes("/__tests__/") || /\.(test|spec)\.tsx?$/.test(rel);

/** Every non-test source file under src/ that mentions withAiCallerOrg. */
function referencingFiles(): string[] {
  return readdirSync(join(REPO, "src"), { recursive: true, encoding: "utf8" })
    .map((f) => `src/${f.replace(/\\/g, "/")}`)
    .filter((rel) => /\.tsx?$/.test(rel) && !isTestFile(rel))
    .filter((rel) => readFileSync(join(REPO, rel), "utf8").includes("withAiCallerOrg"));
}

describe("withAiCallerOrg callers", () => {
  it("only the allowlisted files reference withAiCallerOrg", () => {
    const found = referencingFiles();
    // The scan's own control: it must see every file it allows, or a wrong
    // root would pass vacuously.
    expect(found).toEqual(expect.arrayContaining(Object.keys(ALLOWED)));
    expect(found.filter((rel) => !Object.hasOwn(ALLOWED, rel)), MESSAGE).toEqual([]);
  });
});
