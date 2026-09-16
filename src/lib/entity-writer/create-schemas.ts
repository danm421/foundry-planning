// src/lib/entity-writer/create-schemas.ts
import type { ZodType } from "zod";
import type { DetailEntity } from "@/domain/forge/detail-fields";
import { disabilityPolicyCreateSchema } from "@/lib/schemas/disability-policies";
import { insurancePolicyCreateSchema } from "@/lib/schemas/insurance-policies";

/**
 * The route create schemas this module can validate a row against, keyed
 * exactly as the Details field map names them (`createSchema.module` + "#" +
 * `createSchema.export`).
 *
 * WHY A REGISTRY AND NOT A DYNAMIC IMPORT: `createSchema` on the map is a pair
 * of STRINGS, and `buildWriteRequest` is pure and synchronous — resolving a
 * string to a module at call time would make it async and would defeat every
 * bundler. So the schemas a caller can actually reach are imported by name.
 *
 * WHY ONLY TWO: `buildWriteRequest`'s only caller is the statement-chat map
 * pass, whose entity set is `documentEvidenceEntities()` — today exactly
 * `life_insurance_policy` and `disability_policy`. `create-schemas.test.ts`
 * asserts that every document-evidence entity declaring a schema is registered
 * here, so adding a third entity to the map and forgetting this file is a RED
 * test rather than a silently unvalidated write.
 *
 * CLIENT-SAFE, and it has to stay that way: this module reaches a "use client"
 * component through `commit-map-row.ts`. Both schemas above import only `zod`,
 * `@/lib/schemas/strict-partial` and `@/lib/milestones` (which the field map
 * itself already pulls client-side). Never register a schema whose module
 * touches the database or a node-only API.
 */
const CREATE_SCHEMAS: Record<string, ZodType> = {
  "@/lib/schemas/insurance-policies#insurancePolicyCreateSchema": insurancePolicyCreateSchema,
  "@/lib/schemas/disability-policies#disabilityPolicyCreateSchema": disabilityPolicyCreateSchema,
};

export function createSchemaFor(entity: DetailEntity): ZodType | undefined {
  const declared = entity.createSchema;
  if (!declared) return undefined;
  // A `validatesSubset` schema checks only PART of its route's body (a
  // business account's business-specific keys are delegated elsewhere), so its
  // refusals can name keys this entity does not own. Deliberately not
  // registered — a wrong refusal is worse than none.
  if (declared.validatesSubset) return undefined;
  return CREATE_SCHEMAS[`${declared.module}#${declared.export}`];
}

/**
 * The create schema's own refusal for `payload`, or null when it accepts it
 * (or when this entity has no registered schema).
 *
 * The schema's MESSAGE is kept verbatim — it is the route's own wording, and
 * it states rules no per-field check can express (`validateTermFields`: a term
 * policy needs an issue year, and a term length OR end-at-retirement but never
 * both). Only the field name is translated, from the payload key to the label
 * the advisor reads on screen.
 */
export function createSchemaRefusal(
  entity: DetailEntity,
  payload: Record<string, unknown>,
): string | null {
  const schema = createSchemaFor(entity);
  if (!schema) return null;

  const parsed = schema.safeParse(payload);
  if (parsed.success) return null;

  const named: string[] = [];
  for (const issue of parsed.error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : null;
    const label = key ? (entity.fields.find((f) => f.key === key)?.label ?? key) : null;
    const text = label ? `${label}: ${issue.message}` : issue.message;
    // Zod reports one issue per failing rule, and two rules can land on the
    // same field with the same wording. The advisor should read it once.
    if (!named.includes(text)) named.push(text);
  }
  return named.join("; ");
}
