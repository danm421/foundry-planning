import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/lib/presentations/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@react-pdf/renderer",
              message:
                "src/lib/presentations/ must stay framework-free. Move PDF-rendering code to src/components/presentations/.",
            },
            {
              name: "react",
              message:
                "src/lib/presentations/ must stay framework-free. Move React code to src/components/presentations/.",
            },
          ],
          patterns: [
            {
              group: ["react/*", "@react-pdf/renderer/*"],
              message: "src/lib/presentations/ must stay framework-free.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
