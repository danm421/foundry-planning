import type { EstateFlowChange } from "./estate-flow-diff";

/**
 * A single base-mode HTTP write derived from one estate-flow change.
 *
 * Base mode (no `?scenario=`) has no overlay table — estate-flow edits are
 * committed straight to the client's real data through the legacy per-entity
 * routes. This helper translates a diff change into those calls. It carries
 * route knowledge, so it lives in `lib/`, not the framework-free `engine/`.
 */
export interface BaseWrite {
  url: string;
  method: "PUT" | "PATCH";
  body: unknown;
}

/**
 * Maps one `EstateFlowChange` to the base API request(s) that apply it.
 *
 * - `account` / `entity` owners and beneficiaries go to separate routes, so a
 *   change touching both fields produces two writes (owners first).
 * - Both `/beneficiaries` routes expect the **bare** beneficiary array as the
 *   request body — not `{ beneficiaries: [...] }`.
 * - `will` is always a single PATCH carrying both coupled fields.
 *
 * The engine value shapes already satisfy the target zod schemas, so no shape
 * conversion happens here — this is a pure passthrough.
 */
export function baseWritesForChange(
  change: EstateFlowChange,
  clientId: string,
): BaseWrite[] {
  const { targetKind, targetId, desiredFields } = change.edit;
  const base = `/api/clients/${clientId}`;
  const writes: BaseWrite[] = [];

  switch (targetKind) {
    case "account": {
      if ("owners" in desiredFields) {
        writes.push({
          url: `${base}/accounts/${targetId}`,
          method: "PUT",
          body: { owners: desiredFields.owners },
        });
      }
      if ("beneficiaries" in desiredFields) {
        writes.push({
          url: `${base}/accounts/${targetId}/beneficiaries`,
          method: "PUT",
          body: desiredFields.beneficiaries,
        });
      }
      break;
    }
    case "entity": {
      if ("owners" in desiredFields) {
        writes.push({
          url: `${base}/entities/${targetId}`,
          method: "PUT",
          body: { owners: desiredFields.owners },
        });
      }
      if ("beneficiaries" in desiredFields) {
        writes.push({
          url: `${base}/entities/${targetId}/beneficiaries`,
          method: "PUT",
          body: desiredFields.beneficiaries,
        });
      }
      break;
    }
    case "will": {
      writes.push({
        url: `${base}/wills/${targetId}`,
        method: "PATCH",
        body: {
          bequests: desiredFields.bequests,
          residuaryRecipients: desiredFields.residuaryRecipients,
        },
      });
      break;
    }
  }

  return writes;
}
