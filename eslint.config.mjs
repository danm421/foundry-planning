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
  {
    // Client-safety guard for the CRM bulk import. `patterns`, not `paths`:
    // the barrel is only half the hazard — its server-only subpaths reach db,
    // audit, and exceljs directly and would break the browser bundle just as
    // hard. Only ./columns and ./rows are pure, and they stay allowed.
    //
    // Scope covers src/components/** plus every .tsx under src/app/**, which
    // is where a client component actually lives (route handlers are route.ts
    // and are unaffected). A genuine server component that needs the barrel
    // can opt out with an inline eslint-disable — none does today.
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // `regex`, not `group`: a `group` entry is matched
              // gitignore-style, so a bare "@/lib/crm/import" would sweep in
              // the whole directory and ban ./columns and ./rows too.
              regex: "^@/lib/crm/import(/(preview|commit|dedup|read-file))?$",
              message:
                "@/lib/crm/import and its preview/commit/dedup/read-file modules pull in exceljs, audit, and db and cannot ship to the browser. Import @/lib/crm/import/columns or @/lib/crm/import/rows instead.",
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
