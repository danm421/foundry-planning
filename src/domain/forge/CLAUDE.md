# Forge

**Every NEW Forge tool ships, in the SAME PR, with:**

1. At least one trajectory eval case in `evals/promptfoo.yaml` — a `vars` block with `expectTool: "<tool_name>"` plus the `usedExpectedTool` assertion.
2. An updated count/breakdown in `__tests__/tools-index.test.ts`.

Run `npm run eval:forge` before merge (non-blocking lane).

**Known limitation:** the eval runs the real graph against a fake eval-scope client (`provider.ts` `EVAL_AUTH`), so tool *execution* errors until a seeded eval client exists. The assertions still exercise tool *selection* and the HITL invariant. Assertion logic itself is unit-tested in `evals/__tests__/assertions.test.ts`.
