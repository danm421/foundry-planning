import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The statement-chat surface is a Client Component. Anything it imports is
 * bundled for the browser, so nothing in its transitive import graph may reach
 * a server-only module. Next only reports this at BUILD time — `tsc` and vitest
 * both pass while the page 500s in the browser with
 * "'server-only' cannot be imported from a Client Component module".
 *
 * Importing a BARREL is how this happens: `@/lib/entity-extraction` re-exports
 * `extractMapEntities`, which pulls in the Azure client and Clerk's server
 * `auth()`. Import the leaf module instead.
 */

const SRC = path.resolve(__dirname, "../../..");

// Entry points that ship to the browser.
const CLIENT_ENTRIES = [
  "components/statement-chat/chat-surface.tsx",
  "components/statement-chat/entity-tables.tsx",
];

// Modules that must never be reachable from the browser bundle. These are the
// ones that actually break the build: each either IS `server-only` or requires
// it, which is what makes Next refuse to render the page.
//
// `@/db` is deliberately NOT listed. It does not require `server-only`, so Next
// bundles it without complaint, and `chat-surface` has reached it via
// `review-context` since before this branch (same import on main). That is a
// real smell but a pre-existing one — widening this list to catch it would make
// the gate red for something this branch did not do.
const SERVER_ONLY = [
  "server-only",
  "@clerk/nextjs/server",
  "@/lib/extraction/azure-client",
];

// Type-only statements are erased by the compiler and never reach the bundle,
// so they are NOT a boundary violation — only runtime imports count.
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_RE = /^\s*import\s+["']([^"']+)["']/gm;

function specifiersOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const re of [IMPORT_RE, SIDE_EFFECT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  return out;
}

/** Resolve a specifier to a file under src/, or null if it isn't local. */
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(cand) && !existsSync(path.join(cand, "."))) {
      // plain file
      if (cand.endsWith(".ts") || cand.endsWith(".tsx")) return cand;
    }
  }
  for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** Walk the graph, returning the first path that reaches a server-only module. */
function findServerOnlyPath(entry: string): string[] | null {
  const start = path.join(SRC, entry);
  const seen = new Set<string>();
  const stack: Array<{ file: string; trail: string[] }> = [
    { file: start, trail: [entry] },
  ];

  while (stack.length > 0) {
    const { file, trail } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const spec of specifiersOf(file)) {
      if (SERVER_ONLY.includes(spec)) return [...trail, spec];
      const next = resolveLocal(spec, file);
      if (next && !seen.has(next)) {
        stack.push({ file: next, trail: [...trail, path.relative(SRC, next)] });
      }
    }
  }
  return null;
}

describe("statement-chat client boundary", () => {
  it.each(CLIENT_ENTRIES)(
    "%s does not reach a server-only module",
    (entry) => {
      const offending = findServerOnlyPath(entry);
      expect(
        offending === null ? null : offending.join("\n  → "),
        "Client Component reaches a server-only module; import the leaf module, not the barrel"
      ).toBeNull();
    }
  );

  it("the walker actually traverses (positive control)", () => {
    // entity-tables must genuinely reach the confidence leaf, or the graph walk
    // is not visiting anything and the assertions above are vacuous.
    const start = path.join(SRC, "components/statement-chat/entity-tables.tsx");
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const spec of specifiersOf(f)) {
        const n = resolveLocal(spec, f);
        if (n) stack.push(n);
      }
    }
    expect([...seen].some((f) => f.endsWith("entity-extraction/confidence.ts"))).toBe(true);
    expect(seen.size).toBeGreaterThan(5);
  });
});
