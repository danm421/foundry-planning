import { configDefaults, defineConfig } from "vitest/config";
import { readdirSync, readFileSync } from "fs";
import path from "path";

// Test files that talk to the shared dev Neon branch (via .env.local) run one
// at a time in the "db" project. Several clean up by toggling user triggers on
// shared tables (e.g. account_owners_sum_check) via `ALTER TABLE ... DISABLE
// TRIGGER`, which is database-global: when two such files run in parallel one's
// `finally` re-enables the trigger while the other is mid-cleanup, raising
// spurious sum-check violations. Everything else runs in parallel in the "unit"
// project, whose setup file fails any database connection with directions
// instead of letting it race.
//
// A file is a DB test when it imports `@/db` without mocking it, uses the audit
// test helpers, or reads a database URL. Files that reach the database only
// through the code under test are listed by hand.
const DB_TESTS_WITHOUT_A_DB_IMPORT = [
  "src/lib/integrations/auth.test.ts",
  "src/lib/integrations/connections.test.ts",
  "src/lib/integrations/connections-byok.test.ts",
];
const USES_DB =
  /["']@\/db(\/index)?["']|["']@\/lib\/audit\/test-helpers["']|DATABASE_URL|INTEGRATION_DB_URL/;
const MOCKS_DB = /vi\.(do)?[mM]ock\(\s*["']@\/db(\/index)?["']/;

const dbTestFiles = ["src", "scripts"]
  .flatMap((dir) =>
    readdirSync(path.join(__dirname, dir), { recursive: true, encoding: "utf8" }).map((file) =>
      path.join(dir, file),
    ),
  )
  .filter((file) => /\.test\.tsx?$/.test(file))
  .filter((file) => {
    const source = readFileSync(path.join(__dirname, file), "utf8");
    return USES_DB.test(source) && !MOCKS_DB.test(source);
  })
  .concat(DB_TESTS_WITHOUT_A_DB_IMPORT)
  // Route folders like `[id]` and `(group)` are glob syntax; match them literally.
  .map((file) => file.replace(/[[\](){}*?!+@]/g, "\\$&"));

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
    // `extends: true` reloads this file and appends each project's arrays to
    // the ones above. The two projects run at the same time; "db" runs its
    // files one by one.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: dbTestFiles,
          setupFiles: ["./vitest.unit-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: dbTestFiles,
          fileParallelism: false,
        },
      },
    ],
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
