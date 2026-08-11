// Coverage guard for the advisor's section switches on `/api/portal/*`.
//
// The gate is one line per handler, which is exactly the kind of line a new
// route forgets. This test reads the route files themselves: every handler
// under a gated section must call `requirePortalFeature` with that section's
// key, and every directory under /api/portal must be classified — so adding an
// endpoint to a switchable section, or a whole new section, fails here rather
// than shipping ungated.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTAL_FEATURE_KEYS, type PortalFeatureKey } from "@/lib/portal/features";

// Relative to this file, not process.cwd() — the paths must resolve the same
// whether vitest is run from the repo root or a subdirectory.
const API_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_ROOT = join(API_ROOT, "../../..");

/**
 * Top-level `/api/portal/<dir>` → the switch that hides its section, and where
 * the gate sits.
 *
 * `route` — the handler calls `requirePortalFeature` itself, so the count of
 * gates must equal the count of handlers in the file.
 * `vault` — every handler reaches its data through `resolvePortalVaultContext`,
 * which gates once at the section's front door (some vault handlers never hold
 * a clientId of their own). The file must therefore go through the vault stack,
 * and the context itself must carry the gate.
 */
const GATED: Readonly<Record<string, { feature: PortalFeatureKey; via: "route" | "vault" }>> =
  {
    investments: { feature: "investments", via: "route" },
    // The Budget section owns its three tabs plus the category/rule machinery
    // behind them — all of it disappears with the rail entry.
    budgets: { feature: "budget", via: "route" },
    transactions: { feature: "budget", via: "route" },
    recurrings: { feature: "budget", via: "route" },
    categories: { feature: "budget", via: "route" },
    rules: { feature: "budget", via: "route" },
    documents: { feature: "documents", via: "vault" },
    folders: { feature: "documents", via: "vault" },
  };

/**
 * Endpoints no switch hides: core portal surfaces (organizer data, identity,
 * settings, Plaid link, push) — plus `dashboard`, which is deliberately NOT a
 * 403. Budget-off degrades it instead, passing `budgetEnabled` into the loader
 * so the budgeting numbers are never queried and the tiles are simply gone. A
 * client with a Budget-off portal still has a dashboard.
 */
const CORE = new Set([
  "accounts",
  "dashboard",
  "expenses",
  "family",
  "household",
  "incomes",
  "intake",
  "liabilities",
  "me",
  "plaid",
  "push-tokens",
  "savings-rules",
  "settings",
  "trusts",
]);

// Both handler forms — `export async function GET` and `export const GET =`.
// Matching only the first would score a `const`-style route file 0 handlers,
// which then trivially satisfies "one gate per handler".
const HANDLER =
  /export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
// `[^;]` rather than `[^)]` so the assert form, whose first argument is itself
// a call (`assertPortalFeature(toPortalFeatures(row), "documents")`), matches —
// bounded to the one statement either way.
const GATE = (feature: string): RegExp =>
  new RegExp(`(?:require|assert)PortalFeature\\([^;]*"${feature}"`);

/**
 * Each handler's source, from its `export` to the start of the next one. A
 * whole-file gate count would pass a file that gated one handler twice and its
 * neighbour not at all.
 */
function handlerBodies(src: string): { name: string; body: string }[] {
  const starts = [...src.matchAll(HANDLER)].map((m) => ({
    name: m[1],
    at: m.index ?? 0,
  }));
  return starts.map((s, i) => ({
    name: s.name,
    body: src.slice(s.at, starts[i + 1]?.at ?? src.length),
  }));
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("/api/portal feature gate coverage", () => {
  it("classifies every endpoint directory as gated or core", () => {
    const dirs = readdirSync(API_ROOT).filter(
      (e) => e !== "__tests__" && statSync(join(API_ROOT, e)).isDirectory(),
    );
    const unclassified = dirs.filter((d) => !(d in GATED) && !CORE.has(d));
    expect(unclassified).toEqual([]);
  });

  it("maps every gated directory to a real feature key", () => {
    for (const { feature } of Object.values(GATED)) {
      expect(PORTAL_FEATURE_KEYS).toContain(feature);
    }
  });

  // The vault routes' own 403s are proven for real in feature-gate-403; this
  // pins the gate to the shared context so a new vault route inherits it.
  it("gates the vault context itself on the Documents switch", () => {
    const src = readFileSync(join(SRC_ROOT, "lib/portal/vault-context.ts"), "utf8");
    expect(src).toMatch(GATE("documents"));
  });

  it.each(Object.entries(GATED))("gates every handler under /api/portal/%s", (dir, spec) => {
    const files = routeFiles(join(API_ROOT, dir));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const rel = file.slice(API_ROOT.length + 1);

      if (spec.via === "vault") {
        expect(src, `${rel} must read the vault through the gated context`).toMatch(
          /@\/lib\/portal\/vault-(context|documents|folders)/,
        );
        continue;
      }

      const handlers = handlerBodies(src);
      expect(handlers.length, `${rel} exports no HTTP handler`).toBeGreaterThan(0);
      for (const { name, body } of handlers) {
        expect(body, `${rel} ${name} is missing its "${spec.feature}" gate`).toMatch(
          GATE(spec.feature),
        );
      }
    }
  });
});
