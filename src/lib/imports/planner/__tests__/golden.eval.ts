// Golden-fixture eval for the planning reasoner (`npm run eval:planner`).
//
// This file is picked up ONLY by the eval lane. The default `npm test` lane
// (vitest.config.ts, no `include` key -> vitest's default
// `**/*.{test,spec}.?(c|m)[jt]s?(x)`) cannot match `golden.eval.ts` - it has
// neither suffix. `vitest.eval.config.ts` at the repo root adds this file via
// its own `include` and is the config `eval:planner` passes with `-c`. See
// that file's header for why a positional CLI path is not enough to run this
// file (vitest's positional args are a FILTER over what `include` already
// matched, not a direct loader).
//
// It runs the REAL `runPlanner` (no injected `model`) against real documents,
// via `FIXTURES` in `fixtures/manifest.ts`. Adding a case is a data change:
// drop a scrubbed `<slug>.txt` into `fixtures/` and it starts running with no
// code change here.
//
// Two things must never read as a pass:
//   - An absent fixture file or an absent AZURE_API_KEY. Both produce a NAMED
//     SKIP (decided at collection time, not a runtime early-return), so the
//     reporter's skip count is explicit and a deleted fixture can never look
//     like a silent green.
//   - A `null` from `runPlanner`. Per its own doc comment, `runPlanner` NEVER
//     THROWS - a timeout, an Azure outage, a malformed proposal, and an
//     unconfigured environment are all indistinguishable `null`s. Treating
//     that as "nothing to assert" would make this whole harness vacuous, so a
//     `null` result is a hard FAILURE, distinguished in its message from a
//     wrong-answer assertion failure.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { runPlanner } from "@/lib/imports/planner/run-planner";
import { makePiaEstimator } from "@/lib/imports/planner/pia-estimator";
import { emptyImportPayload } from "@/lib/imports/types";
import { FIXTURES } from "./fixtures/manifest";
import { checkFixtureCase, formatFailures } from "./golden-assertions";

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const HAS_CREDENTIALS = Boolean(process.env.AZURE_API_KEY);
// Below the CLI's --testTimeout=180000 (package.json) so a genuine timeout
// resolves inside runPlanner as a clean, reportable `null` (an R4-style
// failure below) instead of vitest hard-killing the test.
const PLANNER_TIMEOUT_MS = 150_000;

describe("planner golden fixtures", () => {
  for (const fixture of FIXTURES) {
    const fixturePath = path.join(FIXTURE_DIR, `${fixture.slug}.txt`);
    const fixtureExists = existsSync(fixturePath);

    if (!HAS_CREDENTIALS) {
      it.skip(`${fixture.label} [SKIP: AZURE_API_KEY is not set - drop credentials in .env.local to run this]`, () => {});
      continue;
    }
    if (!fixtureExists) {
      it.skip(
        `${fixture.label} [SKIP: fixtures/${fixture.slug}.txt not found - drop it in to enable this case]`,
        () => {},
      );
      continue;
    }

    it(fixture.label, async () => {
      const documentText = readFileSync(fixturePath, "utf-8");
      const decisions = await runPlanner({
        documentText,
        pages: [documentText],
        payload: emptyImportPayload(),
        estimatePia: makePiaEstimator(),
        timeoutMs: PLANNER_TIMEOUT_MS,
      });

      if (decisions === null) {
        throw new Error(
          `[${fixture.slug}] runPlanner returned null. This means the PLANNER IS ` +
            `UNAVAILABLE (timeout, Azure outage, malformed proposal, or a bad/missing ` +
            `deployment) - it is NOT evidence the model got the answer wrong. Check the ` +
            `Azure deployment and credentials before treating this as a prompt regression.`,
        );
      }

      const failures = checkFixtureCase(decisions, fixture.expect);
      if (failures.length > 0) {
        throw new Error(
          `[${fixture.slug}] ${failures.length} assertion(s) failed:\n${formatFailures(fixture.slug, failures)}`,
        );
      }
    });
  }
});
