// src/lib/entity-writer/build-request.ts
import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import { createSchemaRefusal } from "./create-schemas";
import { mergeIntoSet } from "./set-merge";

/**
 * `"PATCH"` is back, with the code that actually builds one (Phase 3A, Task 2).
 *
 * Ruling 34 removed it because it was an empty promise: no path here could
 * produce it, a review table read the promise back out and rendered "Update"
 * for an `exact` match, and that Commit then INSERTED a second record. The
 * update leg below is the work that ruling was waiting for. It is never
 * inferred — an entity opts in by declaring `updateSemantics` on the map
 * (`DetailEntity`), and the method is part of that declaration because the
 * routes do not agree on one. An entity that has not opted in keeps Ruling
 * 34's behaviour: an `exact` match is refused, not created and not updated.
 */
export type WriteRequest =
  | { ok: true; method: "POST" | "PUT" | "PATCH"; path: string; body: unknown; warnings: string[] }
  | { ok: false; error: string };

/**
 * Build the request that writes one candidate row.
 *
 * PURE — no IO. The caller performs the request, prefixing `path` with
 * `/api/clients/<clientId>` and routing it through `authz.ts` / `audit.ts`.
 *
 * Refuses rather than guessing. Every refusal names what the advisor would need
 * to fix, because a refusal here is far cheaper than a 400 or 500 after they
 * have approved a confirmation card.
 */
export function buildWriteRequest(args: {
  entity: DetailEntity;
  row: CandidateRow;
  /** Current rows, required for a `payloadShape: "array"` entity. */
  existingSet?: unknown[];
}): WriteRequest {
  const { entity, row, existingSet } = args;

  if (entity.nestedIn) {
    return {
      ok: false,
      error: `${entity.id} has no route of its own — its rows travel inside "${entity.nestedIn.entity}" under the key "${entity.nestedIn.key}". Write the parent instead.`,
    };
  }

  if (row.missingRequired.length > 0) {
    return {
      ok: false,
      error: `Required field(s) missing — ${row.missingRequired.join(", ")}.`,
    };
  }

  const flagged = row.values.filter((v) => v.issue);
  if (flagged.length > 0) {
    return {
      ok: false,
      error: flagged.map((v) => `${v.key} (${v.issue})`).join(", ") + ".",
    };
  }

  // A row that MATCHES an existing record, held to the same value-quality bar
  // as a create — the guards above run first on purpose.
  if (row.match?.kind === "exact") {
    if (!entity.updateSemantics) {
      // Ruling 34's refusal, now stated where the decision actually is. An
      // entity whose partial-update semantics nobody has designed must not
      // silently CREATE a second record for a row that already exists.
      return {
        ok: false,
        error: `${entity.label} already exists and ${entity.id} has no update leg — edit it on the Details tab instead.`,
      };
    }

    const template = entity.routes.update;
    if (!template) {
      return { ok: false, error: `${entity.id} matched an existing record but has no update route.` };
    }

    // The row's id fills the LAST segment parameter; any other parameter is a
    // nested route this row cannot address, and must refuse rather than post
    // a literal "[accountId]" that 404s with nothing useful to say.
    const path = template.replace(/\[[^\]]+\](?=[^/]*$)/, row.match.existingId);
    const unresolved = path.match(/\[[^\]]+\]/);
    if (unresolved) {
      return {
        ok: false,
        error: `${entity.id} cannot be updated: its route ${template} has an unresolved ${unresolved[0]} segment.`,
      };
    }

    // Unlike a create, an update ACCEPTS `appliesTo: "update"` fields — that is
    // what they are for. `writable: false` is still excluded: no route takes it.
    const updateFields = new Map(entity.fields.map((f) => [f.key, f]));
    const updateBody: Record<string, unknown> = {};
    for (const value of row.values) {
      const field = updateFields.get(value.key);
      if (!field || field.writable === false) continue;
      updateBody[value.key] = value.value;
    }

    // The create leg has refused an empty payload since Ruling 36 (its route
    // schema does it); the update leg had no such floor. `family_member`'s PUT
    // answers 200 to `{}` — it writes nothing and the row then reads
    // "Committed", the false-success shape this surface has already been
    // burned by twice. Refuse it here, where the reason can name the fields.
    if (Object.keys(updateBody).length === 0) {
      return {
        ok: false,
        error: `Nothing to update — none of the values read from the document can be written to ${entity.label}.`,
      };
    }

    return { ok: true, method: entity.updateSemantics.method, path, body: updateBody, warnings: [] };
  }

  // Assemble the body, dropping keys the create path refuses.
  const warnings: string[] = [];
  const fields = new Map(entity.fields.map((f) => [f.key, f]));
  const payload: Record<string, unknown> = {};
  for (const value of row.values) {
    const field = fields.get(value.key);
    if (!field) continue;
    if (field.writable === false) continue;
    if (field.appliesTo === "update") {
      warnings.push(
        `"${field.label}" (${field.key}) was read from the document but the create request does not accept it — it can only be set by editing the row afterwards.`,
      );
      continue;
    }
    payload[value.key] = value.value;
  }

  const shape = entity.payloadShape ?? "object";

  if (shape === "array") {
    const path = entity.routes.update ?? entity.routes.create;
    if (!path) return { ok: false, error: `${entity.id} has no route to write to.` };
    if (!Array.isArray(existingSet)) {
      return {
        ok: false,
        error: `${entity.id} replaces the whole set on write, so the current rows must be supplied before it can be written. Writing without them would delete every existing row.`,
      };
    }
    const { rows } = mergeIntoSet({
      entity,
      existing: existingSet as Record<string, unknown>[],
      incoming: payload,
    });
    return { ok: true, method: "PUT", path, body: rows, warnings };
  }

  const path = entity.routes.create;
  if (!path) {
    return {
      ok: false,
      error: `${entity.id} has no create route — its row is created implicitly by its parent and can only be updated.`,
    };
  }

  if (typeof shape === "object") {
    return { ok: true, method: "POST", path, body: { [shape.wrappedIn]: [payload] }, warnings };
  }

  // Spec Layer 5, wired at last (final review I4, Ruling 36): the route's OWN
  // create schema is the last word on whether this body is writable, and it
  // knows rules the field map cannot express — a term policy needs an issue
  // year, and a term length OR end-at-retirement but never both
  // (`validateTermFields`). Without this a row with every map-`required` field
  // filled passed every check here and 400'd at the route, where the surface
  // could only report the status code.
  //
  // Only the plain-object shape. A wrapped or bare-array body is an ENVELOPE
  // or a whole SET, which its schema validates as a unit rather than one row
  // at a time — `createSchemaFor` registers no such schema, so this is belt
  // and braces on top of that.
  const refusal = createSchemaRefusal(entity, payload);
  if (refusal) return { ok: false, error: refusal };

  return { ok: true, method: "POST", path, body: payload, warnings };
}
