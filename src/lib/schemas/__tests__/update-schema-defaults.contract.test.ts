/**
 * Repo-wide contract: no exported update/PATCH schema may inject a default.
 *
 * ## Why this test exists
 *
 * This repo is on Zod 4, where `.optional()` WRAPS a `ZodDefault` instead of
 * removing it — so the default still fires on an ABSENT key, and `.partial()`
 * (a shape-wide `.optional()` map) inherits the flaw. Our PATCH routes are
 * written as `if (input.X !== undefined) patch.X = input.X`, or as a wholesale
 * `.set({ ...parsed.data })`. An injected key is not `undefined`, so every one
 * of them gets WRITTEN — a one-key PATCH silently overwrites fields the caller
 * never sent. Where a route full-replaces an array field, an injected `[]`
 * deletes every row.
 *
 * `z.infer` gives no warning: a schema that type-checks as `Partial<T>` parses
 * to a full object. That is what makes it invisible in review, and it is why
 * this has now been hand-patched three separate times
 * (`src/lib/intake/schema.ts`, `updateCrmNoteSchema`, `insurance-policies.ts`)
 * before the shared `strictPartial()` fix.
 *
 * Discovery is by filesystem walk, not a hand-kept list, so this test fails the
 * next time someone derives an update schema the naive way — which is the whole
 * point. Same enumerate-and-assert shape as
 * `src/lib/billing/__tests__/active-subscription-lint.test.ts`.
 *
 * ## Fixing a failure
 *
 * Use `strictPartial(createFooSchema)` from `@/lib/schemas/strict-partial`
 * instead of `createFooSchema.partial()`. Do NOT remove the default from the
 * CREATE schema — a create body is complete and the insert paths rely on it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { stripDefault } from "../strict-partial";

const SRC_ROOT = path.resolve(__dirname, "../../..");

/**
 * Allowlist: update schemas that intentionally keep a default.
 * Each entry MUST carry a one-line justification, so a future reader can tell
 * a deliberate exception from an unfixed bug.
 */
const ALLOWLIST: Record<string, string> = {
  willUpdateSchema:
    "Full-replacement API, not a partial one. The wills PATCH route destructures `bequests` UNGUARDED and delete-then-reinserts, so the `[]` default is load-bearing — making this partial would throw `bequests is not iterable` on every will PATCH. `[]` here means 'no bequests', not 'unspecified'. Converting the endpoint to a real partial API is tracked in future-work/schema.",
  grantUpdateSchema:
    "Not a partial schema — it is `grantCreateSchema` under another name, matched here only by its `*UpdateSchema` suffix. The grant endpoint is a PUT that full-replaces: its route deletes every vest tranche for the grant before re-inserting, so the `tranches`/`plannedEvents` `[]` defaults are load-bearing, as is `has83bElection`.",
};

/** Names like `fooUpdateSchema`, `updateFooSchema`, `fooUpdateFieldSchema`. */
const UPDATE_SCHEMA_NAME = /^(?:update[A-Z]\w*|\w*Update\w*)Schema$/;

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/** Every `export const <name>` in `file` whose name looks like an update schema. */
function exportedUpdateSchemaNames(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const names: string[] = [];
  for (const match of source.matchAll(/^export const (\w+)/gm)) {
    if (UPDATE_SCHEMA_NAME.test(match[1])) names.push(match[1]);
  }
  return names;
}

function discover(): Array<{ file: string; name: string }> {
  const files: string[] = [];
  walkTsFiles(SRC_ROOT, files);
  return files
    .flatMap((file) => exportedUpdateSchemaNames(file).map((name) => ({ file, name })))
    .sort((a, b) => `${a.file}${a.name}`.localeCompare(`${b.file}${b.name}`));
}

const DISCOVERED = discover();

/**
 * A schema resurrects an absent key if any wrapper in its chain is a
 * `ZodDefault`. `stripDefault` peels `ZodDefault`/`ZodOptional` down to the
 * inner type; if peeling changed anything, a default (or an optional wrapping
 * one) was present. Compare against a peel that stops at `ZodOptional` so a
 * plain `.optional()` — which is fine — does not register.
 */
function injectsDefault(field: z.ZodTypeAny): boolean {
  let current: z.ZodTypeAny = field;
  while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
    if (current instanceof z.ZodDefault) return true;
    current = (current as z.ZodOptional<z.ZodTypeAny>).def.innerType;
  }
  return false;
}

/**
 * Every object shape a schema can parse into.
 *
 * A `z.discriminatedUnion` of per-field variants (`updateCrmTaskFieldSchema`)
 * is a perfectly good update schema and has no top-level `.shape` — so recurse
 * into its members and check each on merit, rather than exempting it. That way
 * a union member that DOES carry a default still gets caught.
 */
function shapesOf(schema: z.ZodTypeAny): z.ZodRawShape[] {
  const withShape = schema as unknown as { shape?: z.ZodRawShape };
  if (withShape.shape) return [withShape.shape];

  const options = (schema as unknown as { def?: { options?: z.ZodTypeAny[] } }).def?.options;
  if (options) return options.flatMap(shapesOf);

  return [];
}

describe("update-schema default-injection contract", () => {
  it("discovers the repo's update schemas (guards against a broken regex)", () => {
    // A silently-empty walk would make every assertion below vacuously pass.
    // 23 was the count when this test was written (2026-07-30); the floor only
    // needs to prove discovery works, so raise it only if it starts to nag.
    expect(DISCOVERED.length).toBeGreaterThanOrEqual(20);
  });

  it("allowlists only schemas that actually exist", () => {
    const found = new Set(DISCOVERED.map((d) => d.name));
    for (const name of Object.keys(ALLOWLIST)) {
      // A stale allowlist entry would silently exempt nothing while looking
      // like it exempts something.
      expect(found, `allowlisted \`${name}\` no longer exists — drop the entry`).toContain(
        name,
      );
    }
  });

  it.each(DISCOVERED.map((d) => [`${path.relative(SRC_ROOT, d.file)}::${d.name}`, d] as const))(
    "%s does not inject defaults",
    async (_label, { file, name }) => {
      if (ALLOWLIST[name]) return;

      const mod = (await import(file)) as Record<string, unknown>;
      const schema = mod[name] as z.ZodTypeAny | undefined;
      expect(schema, `${name} is not exported from ${file}`).toBeDefined();
      if (!schema) return;

      // --- Structural: no field in the shape is (or wraps) a ZodDefault. -----
      // Uniform across all schemas, including the several with required fields
      // that legitimately reject `{}` and so cannot be checked behaviourally.
      // That gap is not hypothetical: `grantUpdateSchema` rejects `{}` and
      // injects three defaults, two of them arrays a route full-replaces.
      const shapes = shapesOf(schema);
      expect(shapes.length, `${name} has no introspectable shape`).toBeGreaterThan(0);
      const offenders = shapes
        .flatMap((shape) => Object.entries(shape))
        .filter(([, field]) => injectsDefault(field as z.ZodTypeAny))
        .map(([key]) => key);
      expect(
        offenders,
        `${name} injects defaults for ${offenders.join(", ")} — use strictPartial() from @/lib/schemas/strict-partial`,
      ).toEqual([]);

      // --- Behavioural: an empty body parses to an empty object. ------------
      // Only meaningful where `{}` is accepted; schemas with required fields
      // are covered by the structural check above.
      const empty = schema.safeParse({});
      if (empty.success) {
        expect(empty.data, `${name}.parse({}) must be {}`).toEqual({});
      }
    },
  );
});
