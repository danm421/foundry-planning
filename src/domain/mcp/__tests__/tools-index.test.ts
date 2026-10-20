import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ALL_MCP_TOOLS } from "../tools";
import type { McpTool } from "../define-tool";

describe("the MCP tool registry", () => {
  it("exposes exactly 37 tools", () => {
    expect(ALL_MCP_TOOLS).toHaveLength(37);
  });

  it("has unique names, each at most 64 characters", () => {
    const names = ALL_MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(64);
  });

  // The tools that change data. Everything else must stay read-only — the
  // directory listing depends on it, and a tool that slips out of read-only
  // without being named here fails this test.
  const WRITE_TOOLS = new Set([
    "save_what_if_as_scenario",
    "generate_presentation",
    "create_household",
    "start_fact_finder_step",
    "fill_fact_finder_step",
    "review_fact_finder_step",
    "save_fact_finder_step",
    "update_plan_detail",
    "update_plan_assumptions",
    "remove_plan_detail",
  ]);
  // The writes that remove data, so Claude always asks first. Every other write is not destructive.
  const DESTRUCTIVE_TOOLS = new Set(["remove_plan_detail"]);

  it("registers every write tool named above, so a misspelled name can't pass unseen", () => {
    const names = new Set(ALL_MCP_TOOLS.map((t) => t.name));
    for (const name of WRITE_TOOLS) expect(names.has(name), name).toBe(true);
  });

  it("annotates the write tools as making changes and every other tool read-only", () => {
    for (const t of ALL_MCP_TOOLS) {
      expect(t.annotations, t.name).toEqual(
        WRITE_TOOLS.has(t.name)
          ? { readOnlyHint: false, destructiveHint: DESTRUCTIVE_TOOLS.has(t.name), idempotentHint: false, openWorldHint: false }
          : { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      );
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

  // What the connector lists on the wire, roughly as the client receives it.
  it("keeps the whole tool list within 140,000 characters", () => {
    const listed = ALL_MCP_TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: z.toJSONSchema(t.inputSchema),
      annotations: t.annotations,
    }));
    expect(JSON.stringify(listed).length).toBeLessThanOrEqual(140_000);
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
  if (schema instanceof z.ZodUnion) {
    // The first option the union itself accepts — not blindly the first one:
    // a change list's first member (retirement_age, age 40–85) has a number
    // none of the ZodNumber candidates below satisfies.
    for (const option of schema.options as z.ZodTypeAny[]) {
      const value = minimalValueFor(option);
      if (schema.safeParse(value).success) return value;
    }
    return minimalValueFor(schema.options[0] as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodLiteral) return [...(schema as z.ZodLiteral<string>).values][0];
  if (schema instanceof z.ZodString) return "x";
  if (schema instanceof z.ZodNumber) {
    // A bare `1` fails a fractional bound like `targetPoS`'s (0.01, 0.99).
    // Try a small set of candidates and keep the first this schema's OWN
    // constraints actually accept, instead of hand-parsing `.min()`/`.max()`
    // out of zod's internals for each field.
    // 65 for an age bound (create_household's retirementAge, 40–85).
    const candidates = [1, 0.5, 0, 2, -1, 100, 65];
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
  if (schema instanceof z.ZodRecord) {
    // As an array: empty when the schema takes it (a step's sources), one
    // entry when it doesn't (update_plan_detail's cells).
    return schema.safeParse({}).success ? {} : { x: minimalValueFor(schema.valueType as z.ZodTypeAny) };
  }
  if (schema instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.shape)) out[k] = minimalValueFor(v as z.ZodTypeAny);
    return out;
  }
  return undefined;
}

/**
 * The smallest args object that PASSES tool `t`'s own schema, derived from the
 * schema: its required keys, plus the optional ones a refinement across keys
 * asks for (create_household takes household, or householdId with prospect).
 */
function minimalArgsFor(t: McpTool): Record<string, unknown> {
  const required: Record<string, unknown> = {};
  const optional: [string, unknown][] = [];
  for (const [k, v] of Object.entries(t.inputSchema.shape)) {
    const value = minimalValueFor(v as z.ZodTypeAny);
    if (v instanceof z.ZodOptional || v instanceof z.ZodDefault) optional.push([k, value]);
    else required[k] = value;
  }
  // Each subset of the optional keys, none first; the first the schema accepts.
  for (let mask = 0; mask < 2 ** optional.length; mask++) {
    const args = { ...required, ...Object.fromEntries(optional.filter((_, i) => mask & (1 << i))) };
    if (t.inputSchema.safeParse(args).success) return args;
  }
  return required;
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
