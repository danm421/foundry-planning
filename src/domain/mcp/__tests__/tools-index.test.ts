import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ALL_MCP_TOOLS } from "../tools";
import type { McpTool } from "../define-tool";

describe("the MCP tool registry", () => {
  it("exposes exactly 17 tools", () => {
    expect(ALL_MCP_TOOLS).toHaveLength(17);
  });

  it("has unique names, each at most 64 characters", () => {
    const names = ALL_MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(64);
  });

  it("annotates every tool read-only, which the directory requires", () => {
    for (const t of ALL_MCP_TOOLS) {
      expect(t.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("never says co-client, and never promises a goals entity", () => {
    for (const t of ALL_MCP_TOOLS) {
      expect(t.description.toLowerCase()).not.toContain("co-client");
    }
    expect(ALL_MCP_TOOLS.map((t) => t.name)).not.toContain("get_goals");
  });
});

/**
 * F3 / R90: the reviewer measured that swapping a single tool's `z.object`
 * for `z.looseObject` — a one-word, plausible "be lenient" edit — leaves
 * `tsc` at EXIT 0 and every existing test GREEN, while a smuggled extra key
 * (e.g. `firmId`) then reaches the wrapper's `argKeys` audit trail. Nothing
 * on this branch pinned the BEHAVIOUR that closes that hole: the SDK's own
 * pre-callback validation against a plain `z.object()` strips unknown keys
 * before any tool ever sees them. This ratchet asserts that behaviour
 * directly, per tool, so a schema-looseness regression on any of the 17
 * fails here instead of surviving to the wire.
 *
 * Deliberately asserts the BEHAVIOUR (unknown key dropped after `.parse()`),
 * not an internal zod field name — a rename inside zod's own internals
 * cannot break this the way inspecting `._def` would.
 */
function minimalValueFor(schema: z.ZodTypeAny): unknown {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return minimalValueFor(schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodEnum) return schema.options[0];
  if (schema instanceof z.ZodUnion) return minimalValueFor(schema.options[0] as z.ZodTypeAny);
  if (schema instanceof z.ZodString) return "x";
  if (schema instanceof z.ZodNumber) {
    // A bare `1` fails a fractional bound like `targetPoS`'s (0.01, 0.99).
    // Try a small set of candidates and keep the first this schema's OWN
    // constraints actually accept, instead of hand-parsing `.min()`/`.max()`
    // out of zod's internals for each field.
    const candidates = [1, 0.5, 0, 2, -1, 100];
    return candidates.find((n) => schema.safeParse(n).success) ?? 1;
  }
  if (schema instanceof z.ZodBoolean) return true;
  if (schema instanceof z.ZodArray) {
    // Read the "needs at least one element" constraint off the schema
    // itself (does an empty array pass?) rather than hand-parsing `.min()`
    // out of zod's internals — the same "derive it, don't hand-maintain
    // it" rule this whole ratchet exists to enforce.
    return schema.safeParse([]).success
      ? []
      : [minimalValueFor(schema.element as z.ZodTypeAny)];
  }
  if (schema instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.shape)) out[k] = minimalValueFor(v as z.ZodTypeAny);
    return out;
  }
  return undefined;
}

/** The smallest args object that PASSES tool `t`'s own schema, derived from the schema. */
function minimalArgsFor(t: McpTool): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t.inputSchema.shape)) {
    if (v instanceof z.ZodOptional || v instanceof z.ZodDefault) continue;
    out[k] = minimalValueFor(v as z.ZodTypeAny);
  }
  return out;
}

describe("every tool's input schema drops an unrecognized key (F3 / R90)", () => {
  it.each(ALL_MCP_TOOLS.map((t): [string, McpTool] => [t.name, t]))(
    "%s: a smuggled extra key never reaches the parsed args",
    (_name, t) => {
      const minimal = minimalArgsFor(t);
      // Sanity check on the builder itself: the minimal args it derived must
      // actually be valid for this tool, or the assertion below would pass
      // vacuously on a parse failure never inspected.
      expect(() => t.inputSchema.parse(minimal)).not.toThrow();
      const parsed = t.inputSchema.parse({ firmId: "org_attacker", ...minimal }) as Record<
        string,
        unknown
      >;
      expect(parsed).not.toHaveProperty("firmId");
    },
  );
});
