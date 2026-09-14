// src/lib/entity-writer/build-request.ts
import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import { createSchemaRefusal } from "./create-schemas";
import { mergeIntoSet } from "./set-merge";

/**
 * `"PATCH"` is deliberately NOT a member (final review C1, Ruling 34).
 *
 * It was declared, and no code path here could ever produce it — this module
 * returns `POST routes.create` for every object-shaped entity and
 * `PUT routes.update` for a set-replacing one. A review table read the empty
 * promise back out and rendered "Update" for an `exact` match, whose Commit
 * then INSERTED a second record. The update leg is real work (each entity's
 * update route has its own partial-update semantics and nothing in this plan
 * designed them), so the surface refuses an `exact` match instead; adding
 * `"PATCH"` back belongs with the code that actually builds one.
 */
export type WriteRequest =
  | { ok: true; method: "POST" | "PUT"; path: string; body: unknown; warnings: string[] }
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
