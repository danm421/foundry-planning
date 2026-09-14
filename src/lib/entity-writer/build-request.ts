// src/lib/entity-writer/build-request.ts
import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import { mergeIntoSet } from "./set-merge";

export type WriteRequest =
  | { ok: true; method: "POST" | "PATCH" | "PUT"; path: string; body: unknown; warnings: string[] }
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
      error: `${entity.id} cannot be written: required field(s) missing — ${row.missingRequired.join(", ")}.`,
    };
  }

  const flagged = row.values.filter((v) => v.issue);
  if (flagged.length > 0) {
    return {
      ok: false,
      error: `${entity.id} cannot be written: ${flagged
        .map((v) => `${v.key} (${v.issue})`)
        .join(", ")}.`,
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
    if (!existingSet || !Array.isArray(existingSet)) {
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

  return { ok: true, method: "POST", path, body: payload, warnings };
}
