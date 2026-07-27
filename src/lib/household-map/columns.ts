// src/lib/household-map/columns.ts
import type { OwnedThing } from "@/engine/ownership";
import type { ColumnAssignment, ColumnContext } from "./types";

const EPSILON = 0.0001;

/** Round a 0..1 fraction to a whole percent for the split chip. */
function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * Decide which Household Map column an owned thing (account, liability, policy)
 * belongs in.
 *
 * Rules, in order:
 *   1. Any non-family-member owner row (entity, external beneficiary, gifted
 *      away) → tray. Mixed household/entity ownership trays too: the board has
 *      no honest way to draw "half the client's, half the trust's".
 *   2. Sole family-member owner at 100% → that member's role column, but only
 *      when the role is client or spouse. Child / other / unknown → tray.
 *   3. Exactly client + spouse, any split → joint, with a chip when it isn't
 *      50/50.
 *   4. Anything else (no owners, three-plus members) → tray.
 *
 * Pure. No IO. All lookups come from `ctx`.
 */
export function assignColumn(thing: OwnedThing, ctx: ColumnContext): ColumnAssignment {
  const tray = (trayOwnerLabel: string): ColumnAssignment => ({
    column: "tray",
    splitChip: null,
    trayOwnerLabel,
  });

  const owners = thing.owners ?? [];
  if (owners.length === 0) return tray("No owner set");

  // Rule 1 — any non-household owner row sends the whole item to the tray.
  const entityRow = owners.find((o) => o.kind === "entity");
  if (entityRow) {
    const name = ctx.nameByEntityId.get(entityRow.entityId);
    return tray(name ?? "Entity-owned");
  }
  if (owners.some((o) => o.kind === "external_beneficiary" || o.kind === "gifted_away")) {
    return tray("Held outside the household");
  }

  const fmRows = owners.filter((o) => o.kind === "family_member");

  // Rule 2 — sole owner.
  if (fmRows.length === 1 && Math.abs(fmRows[0].percent - 1) < EPSILON) {
    const id = fmRows[0].familyMemberId;
    const role = ctx.roleByFamilyMemberId.get(id);
    if (role === "client") return { column: "client", splitChip: null, trayOwnerLabel: null };
    if (role === "spouse") return { column: "spouse", splitChip: null, trayOwnerLabel: null };
    // A child, an "other", or an id we don't recognise. Tray it and name it —
    // never silently fold it into a principal's column.
    return tray(ctx.nameByFamilyMemberId.get(id) ?? "No owner set");
  }

  // Rule 3 — exactly the two principals.
  if (fmRows.length === 2) {
    const clientRow = fmRows.find(
      (o) => ctx.roleByFamilyMemberId.get(o.familyMemberId) === "client",
    );
    const spouseRow = fmRows.find(
      (o) => ctx.roleByFamilyMemberId.get(o.familyMemberId) === "spouse",
    );
    if (clientRow && spouseRow) {
      const even = Math.abs(clientRow.percent - spouseRow.percent) < EPSILON;
      return {
        column: "joint",
        splitChip: even ? null : `${pct(clientRow.percent)}/${pct(spouseRow.percent)}`,
        trayOwnerLabel: null,
      };
    }
  }

  // Rule 4 — anything we can't describe in three columns.
  return tray("No owner set");
}
