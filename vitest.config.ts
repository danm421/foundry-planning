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
    },
  },
});
