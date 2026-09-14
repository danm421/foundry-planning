// src/domain/forge/detail-fields/__tests__/schema-conformance.test.ts
//
// The other guard checks that the NAMES in the catalogue exist: a real table, a
// real route, a real schema export. Every one of those can pass while the field
// data underneath is wrong — a key marked optional that zod requires, an enum
// that has gained a value, a payload key the catalogue never mentions.
//
// That gap matters more here than in most catalogues. Forge shows the advisor a
// confirmation card built from this data and writes only after they approve, so
// a wrong `required` surfaces as a 400 AFTER approval, on real client money.
//
// So for the 35 entities whose route validates with a zod schema, this compares
// the catalogue against the schema itself — introspected via `z.toJSONSchema`,
// not re-typed. Entities whose route validates ad hoc are out of reach and stay
// covered by the name-level guard alone.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { DETAIL_ENTITIES } from "../index";
import type { DetailEntity } from "../types";

type JsonSchema = {
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
};

const withSchema = DETAIL_ENTITIES.filter((e) => e.createSchema);

async function introspect(e: DetailEntity): Promise<JsonSchema | null> {
  const mod = (await import(/* @vite-ignore */ e.createSchema!.module)) as Record<string, unknown>;
  const schema = mod[e.createSchema!.export];
  if (!schema) return null;
  return z.toJSONSchema(schema as z.ZodType, { io: "input" }) as JsonSchema;
}

/**
 * Entities whose named schema carries no introspectable shape, so there is
 * nothing here to compare against. Listed explicitly rather than skipped
 * silently, so a NEW opaque entity shows up as a failure instead of quietly
 * dropping out of coverage.
 */
const OPAQUE: Record<string, string> = {
  account_owner_split:
    "accountCreateSchema types `owners` as an array with no item schema, so zod exposes no row shape",
};

/**
 * Walk to the object that actually describes this entity's fields. The catalogue
 * states where that is — `payloadShape` for its own route's body, `nestedIn` for
 * rows carried inside a parent's payload — so this follows the declaration
 * rather than guessing, and a wrong declaration fails here.
 */
function locate(js: JsonSchema, e: DetailEntity): JsonSchema | null {
  let node = flatten(js as Record<string, unknown>);
  // `nestedIn` says where rows live in the PARENT payload. Some of those
  // entities name their own row schema instead of the parent's; walk only when
  // the schema actually exposes the key.
  const nestKey = e.nestedIn?.key;
  const props = node.properties as Record<string, Record<string, unknown>> | undefined;
  if (nestKey && props?.[nestKey]) {
    node = flatten(unwrapArray(props[nestKey]));
  } else if (e.payloadShape === "array") {
    node = flatten(unwrapArray(node));
  } else if (typeof e.payloadShape === "object") {
    const wrapped = props?.[e.payloadShape.wrappedIn];
    if (!wrapped) return null;
    node = flatten(unwrapArray(wrapped));
  }
  return (node.properties ? node : null) as JsonSchema | null;
}

/** Step through an array schema, and any nullable union wrapped around it. */
function unwrapArray(node: Record<string, unknown>): Record<string, unknown> {
  const items = node.items as Record<string, unknown> | undefined;
  if (items) return items;
  const arm = (node.anyOf as Record<string, unknown>[] | undefined)?.find((a) => a.items || a.properties);
  if (arm) return (arm.items as Record<string, unknown>) ?? arm;
  return node;
}

/**
 * Collapse a discriminated union (a will bequest is asset | cash | liability)
 * into one object: every arm's keys are writable, but a key is only REQUIRED if
 * every arm requires it — otherwise the catalogue would have to claim a key is
 * mandatory when one arm never accepts it.
 */
function flatten(node: Record<string, unknown>): Record<string, unknown> {
  const arms = (node.oneOf ?? node.anyOf) as Record<string, unknown>[] | undefined;
  if (!arms || !arms.every((a) => a.properties)) return node;
  // A key can be typed differently per arm (a bequest's `liabilityId` is null on
  // the asset arm, a uuid on the liability arm). Keep every arm's definition so
  // "does this accept null / what values does it take" stays answerable.
  const collected = new Map<string, unknown[]>();
  for (const arm of arms) {
    for (const [k, v] of Object.entries(arm.properties as Record<string, unknown>)) {
      collected.set(k, [...(collected.get(k) ?? []), v]);
    }
  }
  const properties: Record<string, unknown> = {};
  for (const [k, defs] of collected) properties[k] = defs.length === 1 ? defs[0] : { anyOf: defs };
  const required = (arms[0].required as string[] | undefined ?? []).filter((k) =>
    arms.every((a) => (a.required as string[] | undefined ?? []).includes(k)),
  );
  return { ...node, properties, required };
}

function enumOf(p: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(p.enum)) return p.enum as string[];
  const anyOf = p.anyOf as Record<string, unknown>[] | undefined;
  return anyOf?.map((a) => a.enum).find(Array.isArray) as string[] | undefined;
}

describe("catalogue matches the zod schema it names", () => {
  it("has schema-backed entities to check", () => {
    expect(withSchema.length).toBeGreaterThan(20);
  });

  for (const e of withSchema) {
    it(`${e.id} agrees with ${e.createSchema!.export}`, async () => {
      const js = await introspect(e);
      expect(js, `${e.createSchema!.export} is not exported`).not.toBeNull();

      const keys = e.fields.map((f) => f.key);
      const found = locate(js!, e);
      if (OPAQUE[e.id]) {
        expect(found?.properties, `${e.id} is listed as opaque but now has a shape — remove the entry`).toBeUndefined();
        return;
      }
      expect(found, `${e.id}: its declared position is not in ${e.createSchema!.export}`).not.toBeNull();

      const props = found!.properties ?? {};
      const required = new Set(found!.required ?? []);
      const problems: string[] = [];

      for (const f of e.fields) {
        const p = props[f.key];
        if (!p) {
          // An update-only field is legitimately absent from the CREATE schema —
          // that is exactly what `appliesTo: "update"` records. Anything else
          // missing is a field zod would silently strip.
          if (f.writable !== false && f.appliesTo !== "update" && !e.createSchema!.validatesSubset) {
            problems.push(`${f.key}: not a key of the schema (mark appliesTo:"update" if update-only)`);
          }
          continue;
        }
        if (f.appliesTo === "update") {
          problems.push(`${f.key}: marked update-only but the create schema accepts it`);
        }
        if (Boolean(f.required) !== required.has(f.key)) {
          problems.push(`${f.key}: catalogue required=${Boolean(f.required)}, schema=${required.has(f.key)}`);
        }
        const schemaEnum = enumOf(p);
        const sorted = (v: readonly string[]) => [...v].sort().join("|");
        if (f.enumValues && schemaEnum && sorted(f.enumValues) !== sorted(schemaEnum)) {
          problems.push(`${f.key}: enum is [${f.enumValues}], schema says [${schemaEnum}]`);
        }
        if (f.nullable && !JSON.stringify(p).includes('"type":"null"')) {
          problems.push(`${f.key}: marked nullable, schema does not accept null`);
        }
      }

      const undocumented = e.createSchema!.validatesSubset
        ? []
        : Object.keys(props).filter((k) => !keys.includes(k));
      if (undocumented.length) problems.push(`schema keys missing from catalogue: ${undocumented.join(", ")}`);

      expect(problems, `\n  - ${problems.join("\n  - ")}\n`).toEqual([]);
    });
  }
});
