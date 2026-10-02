/**
 * An account dialog's body as a scenario `edit`'s fields: the body minus a
 * `growthRate: null`. The form sends null for a rate its growth source derives
 * (the plan default, a model portfolio), but the base tree holds the RESOLVED
 * rate, so the null diffed in as a change the advisor never made
 * (`growthRate: 0.0323… → null`). Left out, the scenario keeps the resolved
 * rate, and a change of source is re-resolved anyway
 * (`reResolveEditedAccountGrowth`). Base-mode PUTs keep the null.
 */
export function scenarioAccountEditFields<T extends { growthRate?: unknown }>(
  body: T,
): Record<string, unknown> {
  if (body.growthRate !== null) return body;
  const fields: Record<string, unknown> = { ...body };
  delete fields.growthRate;
  return fields;
}
