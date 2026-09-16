// src/domain/forge/detail-fields/__tests__/detail-fields.test.ts
//
// Drift guard for the hand-authored Details field map.
//
// The map is written by hand because there is no single artifact to generate it
// from — about half the Details write routes validate with a zod schema in
// `src/lib/schemas/` and the other half validate ad hoc inside the handler. That
// makes it exactly the kind of file that rots: a route gets renamed, a table gets
// dropped, and the map keeps confidently describing something that no longer
// exists. Forge would then propose a write that 404s AFTER the advisor approved
// it on a confirmation card.
//
// So every structural claim the map makes is pinned here against the real
// filesystem and the real schema. These are pure file reads — no DB, no network.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DETAIL_ENTITIES, TAB_ROUTES, documentEvidenceEntities, findEntity } from "../index";
import { YEAR_REFS } from "@/lib/milestones";
import type { DetailEntity } from "../types";
import * as schema from "@/db/schema";

const REPO = path.resolve(__dirname, "../../../../..");
const SCHEMA = fs.readFileSync(path.join(REPO, "src/db/schema.ts"), "utf8");
const CLIENT_API = path.join(REPO, "src/app/api/clients/[id]");
const DETAILS_DIR = path.join(REPO, "src/app/(app)/clients/[id]/details");

function routePaths(e: DetailEntity): string[] {
  return Object.values(e.routes).filter((r): r is string => typeof r === "string");
}

describe("Details field map", () => {
  it("gives every entity a unique id", () => {
    const ids = DETAIL_ENTITIES.map((e) => e.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("gives every field a unique key within its entity", () => {
    for (const e of DETAIL_ENTITIES) {
      const keys = e.fields.map((f) => f.key);
      expect(new Set(keys).size, `duplicate field key in ${e.id}`).toBe(keys.length);
    }
  });

  it("names a table that really exists in the schema", () => {
    for (const e of DETAIL_ENTITIES) {
      expect(
        SCHEMA.includes(`export const ${e.table} = pgTable`),
        `${e.id} names table "${e.table}", which is not exported from src/db/schema.ts`,
      ).toBe(true);
    }
  });

  it("names routes that really exist on disk", () => {
    for (const e of DETAIL_ENTITIES) {
      for (const r of routePaths(e)) {
        expect(r.startsWith("/"), `${e.id} route "${r}" must start with "/"`).toBe(true);
        const file = path.join(CLIENT_API, r.slice(1), "route.ts");
        expect(fs.existsSync(file), `${e.id} names route "${r}", which has no route.ts`).toBe(true);
      }
    }
  });

  it("pairs enum fields with their allowed values, and only those", () => {
    for (const e of DETAIL_ENTITIES) {
      for (const f of e.fields) {
        const label = `${e.id}.${f.key}`;
        if (f.kind === "enum") {
          expect(f.enumValues?.length, `${label} is an enum with no values`).toBeGreaterThan(0);
        } else {
          expect(f.enumValues, `${label} is not an enum but lists values`).toBeUndefined();
        }
      }
    }
  });

  it("names zod create schemas that are really exported", () => {
    // Several entities share a schema module (three point at wills.ts alone),
    // so read each file once rather than once per entity.
    const sources = new Map<string, string>();
    for (const e of DETAIL_ENTITIES) {
      if (!e.createSchema) continue;
      const file = path.join(REPO, "src", e.createSchema.module.replace(/^@\//, "") + ".ts");
      expect(fs.existsSync(file), `${e.id} names missing schema module ${e.createSchema.module}`).toBe(true);
      let source = sources.get(file);
      if (source === undefined) {
        source = fs.readFileSync(file, "utf8");
        sources.set(file, source);
      }
      expect(
        source.includes(`export const ${e.createSchema.export}`),
        `${e.id} names "${e.createSchema.export}", not exported from ${e.createSchema.module}`,
      ).toBe(true);
    }
  });

  it("names write cores that really exist", () => {
    for (const e of DETAIL_ENTITIES) {
      if (!e.writeCore) continue;
      const file = path.join(REPO, "src", e.writeCore.replace(/^@\//, "") + ".ts");
      expect(fs.existsSync(file), `${e.id} names missing write core ${e.writeCore}`).toBe(true);
    }
  });

  it("names Forge tools that really exist", () => {
    const toolsDir = path.join(REPO, "src/domain/forge/tools");
    const source = fs
      .readdirSync(toolsDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => fs.readFileSync(path.join(toolsDir, f), "utf8"))
      .join("\n");
    for (const e of DETAIL_ENTITIES) {
      for (const name of Object.values(e.forgeTool ?? {})) {
        if (!name) continue;
        expect(
          source.includes(`name: "${name}"`),
          `${e.id} claims Forge tool "${name}", which no tool defines`,
        ).toBe(true);
      }
    }
  });

  it("routes every tab to a Details page that exists", () => {
    for (const [tab, href] of Object.entries(TAB_ROUTES)) {
      expect(
        fs.existsSync(path.join(DETAILS_DIR, href, "page.tsx")),
        `tab "${tab}" points at details/${href}, which has no page.tsx`,
      ).toBe(true);
    }
    for (const e of DETAIL_ENTITIES) {
      expect(TAB_ROUTES[e.tab], `${e.id} sits on unknown tab "${e.tab}"`).toBeDefined();
    }
  });

  // The unique-id check above cannot see this: two entities with DIFFERENT ids
  // ("savings_rule" and "savings_rules") described the same table and the same
  // create route, leaving Forge two handles for one write target and no
  // principled way to pick. One write target, one entity — unless the overlap is
  // deliberate AND named below, so a new accidental one still fails here.
  const SHARED_WRITE_TARGETS: Record<string, string> = {
    "accounts /accounts":
      "a business is an account with category 'business' plus business-only fields, " +
      "written through the same route under its own create schema",
  };

  it("gives each write target exactly one entity", () => {
    const seen = new Map<string, string>();
    for (const e of DETAIL_ENTITIES) {
      if (!e.routes.create) continue;
      const target = `${e.table} ${e.routes.create}`;
      if (SHARED_WRITE_TARGETS[target]) continue;
      const prior = seen.get(target);
      expect(prior, `${e.id} and ${prior} both own ${target}`).toBeUndefined();
      seen.set(target, e.id);
    }
  });

  it("does not keep an exemption for an overlap that no longer exists", () => {
    for (const target of Object.keys(SHARED_WRITE_TARGETS)) {
      const owners = DETAIL_ENTITIES.filter(
        (e) => e.routes.create && `${e.table} ${e.routes.create}` === target,
      );
      expect(owners.length, `exemption "${target}" is stale — nothing shares it`).toBeGreaterThan(1);
    }
  });

  // Every "*YearRef" field offers the same milestone anchors. These were once
  // hand-copied into nine separate literals; adding a milestone would have left
  // Forge offering a stale list from whichever copies were missed. Pin them to
  // the real export so a re-inlined literal fails here.
  it("takes every year-ref field's values from @/lib/milestones", () => {
    const refs = [...YEAR_REFS];
    let checked = 0;
    for (const e of DETAIL_ENTITIES) {
      for (const f of e.fields) {
        if (!/YearRef$/.test(f.key)) continue;
        checked++;
        expect([...(f.enumValues ?? [])], `${e.id}.${f.key} does not match YEAR_REFS`).toEqual(refs);
      }
    }
    expect(checked, "no year-ref fields found — has the key naming changed?").toBeGreaterThan(0);
  });

  it("points every nestedIn at a real parent entity", () => {
    const ids = new Set(DETAIL_ENTITIES.map((e) => e.id));
    for (const e of DETAIL_ENTITIES) {
      if (!e.nestedIn) continue;
      expect(ids.has(e.nestedIn.entity), `${e.id} nests in unknown entity "${e.nestedIn.entity}"`).toBe(true);
      const parent = DETAIL_ENTITIES.find((p) => p.id === e.nestedIn!.entity)!;
      // The parent must carry the key its children arrive under, or a caller
      // reading the parent alone has no idea the children can be sent at all.
      expect(
        parent.fields.some((f) => f.key === e.nestedIn!.key),
        `${parent.id} has no "${e.nestedIn!.key}" field, but ${e.id} says its rows are sent under it`,
      ).toBe(true);
    }
  });
});

describe("document-evidence marking", () => {
  it("marks exactly the entities a document can state", () => {
    expect(documentEvidenceEntities().map((e) => e.id).sort()).toEqual([
      "client_household",
      "disability_policy",
      "family_member",
      "life_insurance_policy",
    ]);
  });

  it("every document-evidence entity tells the classifier what its document looks like", () => {
    for (const entity of documentEvidenceEntities()) {
      expect(entity.documentHints?.length, `${entity.id} has no document hints`).toBeGreaterThan(0);
    }
  });

  it("every identity field exists on its own entity", () => {
    for (const entity of DETAIL_ENTITIES) {
      if (!entity.identity) continue;
      const keys = new Set(entity.fields.map((f) => f.key));
      for (const key of entity.identity) {
        expect(keys.has(key), `${entity.id}.identity names missing field "${key}"`).toBe(true);
      }
    }
  });

  it("an identity field is never one the server refuses on create", () => {
    for (const entity of DETAIL_ENTITIES) {
      if (!entity.identity) continue;
      for (const key of entity.identity) {
        const field = entity.fields.find((f) => f.key === key)!;
        expect(field.appliesTo, `${entity.id}.${key} is update-only, so it cannot identify a new row`).not.toBe("update");
        expect(field.writable, `${entity.id}.${key} is derived, so it cannot identify a row`).not.toBe(false);
      }
    }
  });

  it("no advisor-choice entity is marked as document evidence", () => {
    const NEVER_ON_A_DOCUMENT = ["techniques", "assumptions", "observations"];
    for (const entity of documentEvidenceEntities()) {
      expect(NEVER_ON_A_DOCUMENT, `${entity.id} is on the ${entity.tab} tab and cannot be document evidence`).not.toContain(entity.tab);
    }
  });

  it("every document-evidence entity can actually be written", () => {
    for (const entity of documentEvidenceEntities()) {
      // Three ways an extracted row can land: the entity's own create route, a
      // parent's payload, or an update leg it has explicitly opted into. The
      // third is not a loophole — `client_household` is a singleton that is
      // never CREATED from a document (the client already exists), so an
      // update leg is the only write it can ever have.
      const updatable = Boolean(entity.updateSemantics) && Boolean(entity.routes.update);
      const writable = Boolean(entity.routes.create) || Boolean(entity.nestedIn) || updatable;
      expect(writable, `${entity.id} is marked document evidence but has no create route, is not nested, and declares no update leg`).toBe(true);
    }
  });

  it("document hints are non-empty strings when present", () => {
    for (const entity of DETAIL_ENTITIES) {
      for (const hint of entity.documentHints ?? []) {
        expect(hint.trim().length, `${entity.id} has an empty document hint`).toBeGreaterThan(0);
      }
    }
  });

  it("an alias never duplicates its own field label", () => {
    for (const entity of DETAIL_ENTITIES) {
      for (const field of entity.fields) {
        for (const alias of field.aliases ?? []) {
          expect(alias.toLowerCase(), `${entity.id}.${field.key} aliases its own label`).not.toBe(field.label.toLowerCase());
        }
      }
    }
  });

  // Scoped to the entities `loadExistingRows` can actually be called for: the
  // map pass loads existing rows only for an entity that declares an
  // `identity` (`map-entity-pass.ts`), and the loader itself throws without a
  // scopePath. `client_household` is why the rule is not "every
  // document-evidence entity" — a singleton addressed by the client id, whose
  // match is supplied directly, is never loaded and has no client column to
  // declare.
  it("every identity-matched document-evidence entity declares how its table reaches a client", () => {
    let checked = 0;
    for (const entity of documentEvidenceEntities()) {
      if (!entity.identity?.length) continue;
      checked++;
      expect(entity.scopePath, `${entity.id} has no scopePath, so a generic loader would read it unscoped`).toBeDefined();
    }
    expect(checked, "no identity-matched document-evidence entity — this guard asserted nothing").toBeGreaterThan(0);
  });

  it("a join scope path names a real table and a real column", () => {
    for (const entity of DETAIL_ENTITIES) {
      const path = entity.scopePath;
      if (path?.via !== "join") continue;
      const through = (schema as Record<string, unknown>)[path.through];
      expect(through, `${entity.id}.scopePath.through names "${path.through}", which is not a table in the schema`).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(through as object, "clientId"),
        `${entity.id} joins through "${path.through}", which has no clientId to scope by`,
      ).toBe(true);
      const own = (schema as Record<string, unknown>)[entity.table];
      expect(
        Object.prototype.hasOwnProperty.call(own as object, path.on),
        `${entity.id}.scopePath.on names "${path.on}", which is not a column on ${entity.table}`,
      ).toBe(true);
    }
  });
});

describe("the two Phase 2 entities", () => {
  it("life insurance has no identity key — matchLifePolicy owns that job", () => {
    expect(findEntity("life_insurance_policy")!.identity).toBeUndefined();
  });

  it("disability identifies a row by name, insured and carrier", () => {
    expect(findEntity("disability_policy")!.identity).toEqual(["name", "insured", "carrier"]);
  });

  it("the death benefit carries the wordings a policy actually prints", () => {
    const face = findEntity("life_insurance_policy")!.fields.find((f) => f.key === "faceValue")!;
    expect(face.aliases).toContain("Face Amount");
  });
});

describe("phase 3A people entities", () => {
  const PRIMARY_CONTACT_KEYS = ["email", "phone", "mobile", "city", "country"];

  it("asks for the client's own contact fields, not just the spouse's", () => {
    const household = findEntity("client_household");
    if (!household) throw new Error("client_household missing");
    const keys = household.fields.map((f) => f.key);
    for (const key of PRIMARY_CONTACT_KEYS) {
      expect(keys).toContain(key);
      expect(keys).toContain(`spouse${key[0].toUpperCase()}${key.slice(1)}`);
    }
  });

  it("marks the household and family as readable from a document", () => {
    expect(findEntity("client_household")?.documentEvidence).toBe(true);
    expect(findEntity("family_member")?.documentEvidence).toBe(true);
  });

  it("gives family_member a single-field identity so a missing DOB cannot duplicate a child", () => {
    expect(findEntity("family_member")?.identity).toEqual(["firstName"]);
  });

  it("declares update semantics for both", () => {
    expect(findEntity("client_household")?.updateSemantics).toEqual({ method: "PUT" });
    expect(findEntity("family_member")?.updateSemantics).toEqual({ method: "PUT" });
  });

  it("scopes family_member by its own client column", () => {
    expect(findEntity("family_member")?.scopePath).toEqual({ via: "column" });
  });
});
