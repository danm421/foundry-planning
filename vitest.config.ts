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
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
