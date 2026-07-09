import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noRawHex from "./eslint-rules/no-raw-hex.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Ban raw hex so the brand token system can't drift back. Ignores the
    // token sources (brand mirror, chart-colors band helper, the
    // scenario-identity palette), report token modules (**/tokens.ts), tests
    // (hex fixtures/assertions), and the white-label PDF/print layers, where
    // print hex legitimately lives.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/brand/**",
      "src/lib/chart-colors.ts",
      // Position-stable scenario-identity palette shared by the cash-flow
      // overlay chart and the estate compare view — a palette source, like tokens.ts.
      "src/lib/scenario/series-palette.ts",
      "**/tokens.ts",
      "**/*.test.{ts,tsx}",
      "**/__tests__/**",
      "src/lib/presentations/**",
      // react-pdf artifact renderers (print hex; generated PDFs stay byte-stable)
      "src/lib/report-artifacts/artifacts/**",
      "src/components/pdf/**",
      // Report PDF renderers (react-pdf print layer): print hex lives here and
      // the generated PDFs must stay byte-stable.
      "src/components/*-report-pdf/**",
      "src/components/**/*-pdf.tsx",
    ],
    plugins: { brand: { rules: { "no-raw-hex": noRawHex } } },
    rules: { "brand/no-raw-hex": "error" },
  },
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
    // Self-contained Expo app — not Next.js, gets its own lint later if wanted.
    "mobile/**",
  ]),
]);

export default eslintConfig;
