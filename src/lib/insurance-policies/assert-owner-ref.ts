import {
  assertEntitiesInClient,
  assertExternalBeneficiariesInClient,
  assertFamilyMembersInClient,
  type FkCheck,
} from "@/lib/db-scoping";
import type { OwnerRef } from "./owner-ref";

/**
 * A policy owner arrives as a discriminated id in the request body and is
 * written straight into `account_owners`. The DB foreign key only proves the
 * row exists somewhere — not that it belongs to THIS client. Without this the
 * policy could be owned by another client's entity, and that entity's later
 * deletion would cascade this firm's row away.
 *
 * `joint` carries no id and is derived server-side from the client's own
 * family members, so it needs no check.
 */
export async function assertOwnerRefInClient(
  clientId: string,
  ref: OwnerRef,
): Promise<FkCheck> {
  switch (ref.kind) {
    case "joint":
      return { ok: true };
    case "family":
      return assertFamilyMembersInClient(clientId, [ref.id]);
    case "entity":
      return assertEntitiesInClient(clientId, [ref.id]);
    case "external":
      return assertExternalBeneficiariesInClient(clientId, [ref.id]);
  }
}
