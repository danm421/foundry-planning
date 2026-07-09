import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@contracts": path.resolve(__dirname, "../src/lib/portal/contracts.ts"),
    },
  },
});
