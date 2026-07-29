import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// A separate config, not a CLI flag, because vitest's positional CLI args are
// a FILTER applied to whatever `include` already matched - they cannot load a
// file `include` doesn't already select. `vitest.config.ts` has no `include`
// key, so its default (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) applies, and
// `golden.eval.ts` matches neither `*.test.ts` nor `*.spec.ts`. `--include` is
// not a valid vitest CLI flag.
//
// `mergeConfig` against the base config (not a standalone one) so this lane
// keeps the base's `resolve.alias` (`@` -> `./src`, `server-only`'s no-op
// shim) and its `setupFiles` (dotenv load of `.env.local`, jsdom shims) -
// `golden.eval.ts` imports `@/lib/imports/...`, and needs the same env
// loading path production code gets.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["src/lib/imports/planner/__tests__/*.eval.ts"],
    },
  }),
);
