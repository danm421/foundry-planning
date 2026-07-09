import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Sibling feature branches live under `.worktrees/<slug>/` and carry
    // their own copy of `src/`. Without this exclude vitest descends into
    // those copies, runs in-flight tests, and (since they all share the
    // same dev Neon branch via .env.local) hits FK races that surface as
    // spurious failures on `main`.
    exclude: [
      ...configDefaults.exclude,
      "**/.worktrees/**",
      // `.claude/worktrees/<slug>/` mirrors are authored by Claude Code's
      // worktree tooling and carry their own copy of `src/`. Same race
      // hazard as the dotted `.worktrees/` siblings — exclude both.
      "**/.claude/worktrees/**",
      // `.claire/worktrees/<slug>/` is a gitignored local mirror dir from an
      // alternate worktree tool. Same hazard: vitest descends into a stale
      // copy whose `@/` alias still resolves to the main `src/`, so in-flight
      // feature modules fail to import and surface as spurious failures.
      "**/.claire/worktrees/**",
      // `mobile/` is a self-contained Expo app with its own package.json,
      // vitest config, and node_modules — run its tests via `cd mobile &&
      // npm test`, not the root web suite.
      "**/mobile/**",
    ],
    // Several test files clean up by toggling user triggers on shared tables
    // (e.g. account_owners_sum_check) via `ALTER TABLE ... DISABLE TRIGGER`,
    // which is database-global. When two such files run in parallel one's
    // `finally` re-enables the trigger while the other is mid-cleanup, raising
    // spurious sum-check violations. Disable file-level parallelism so
    // DB-touching tests can't race each other on the shared dev Neon branch.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws unless the bundler sets the `react-server` export
      // condition (Next's server graph does; vitest doesn't), which would break
      // unit tests that import server-only modules directly (audit snapshots,
      // crm-tasks helpers). Alias it to the package's own no-op `empty.js` —
      // the exact module the react-server condition selects — via an absolute
      // path, since the package `exports` map doesn't expose the subpath.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
