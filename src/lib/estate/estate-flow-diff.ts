import type { ClientData } from "@/engine/types";
import type { ScenarioEdit } from "@/hooks/use-scenario-writer";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EstateFlowChange {
  /** Human-readable summary for the unsaved-changes list. */
  description: string;
  /** The overlay edit to submit. Always op: "edit". */
  edit: ScenarioEdit & {
    op: "edit";
    targetKind: "account" | "entity" | "will";
    targetId: string;
    desiredFields: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Internal deep-equality helper
// ---------------------------------------------------------------------------

/**
 * Recursive structural deep-equality for plain-object / array / primitive
 * values (the domain of `ClientData` fat-fields such as `owners`,
 * `beneficiaries`, `bequests`, and `residuaryRecipients`).
 *
 * Contract:
 * - `undefined` and `null` are treated as equivalent.
 * - Object key order is ignored (checks every key in both objects).
 * - Array element order is significant (owners/beneficiaries order matters).
 * - No external dependencies; no JSON serialisation.
 */
function eq(a: unknown, b: unknown): boolean {
  const av = a ?? null;
  const bv = b ?? null;
  if (av === bv) return true;
  if (av === null || bv === null) return false;
  if (Array.isArray(av) && Array.isArray(bv)) {
    if (av.length !== bv.length) return false;
    return av.every((item, i) => eq(item, bv[i]));
  }
  if (typeof av === "object" && typeof bv === "object") {
    const ak = Object.keys(av as object);
    const bk = Object.keys(bv as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      eq((av as Record<string, unknown>)[k], (bv as Record<string, unknown>)[k]),
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Diffs a working-copy `ClientData` against the loaded original and returns
 * one `EstateFlowChange` per changed entity (account / entity / will).
 *
 * Rules:
 * - Compares `owners` and `beneficiaries` on accounts and entities.
 * - Compares `bequests` and `residuaryRecipients` on wills (always emitted together).
 * - If both `owners` and `beneficiaries` changed on the same row → ONE edit
 *   with both fields in `desiredFields`.
 * - Rows present only in the working copy (adds) or only in the original
 *   (removes) are skipped — v1 handles edits only.
 * - Output order: accounts first, then entities, then wills.
 */
export function diffWorkingCopy(
  original: ClientData,
  working: ClientData,
): EstateFlowChange[] {
  const changes: EstateFlowChange[] = [];

  // ── Accounts ──────────────────────────────────────────────────────────────

  const origAcc = new Map((original.accounts ?? []).map((a) => [a.id, a]));
  for (const a of working.accounts ?? []) {
    const o = origAcc.get(a.id);
    if (!o) continue; // skip adds

    const desiredFields: Record<string, unknown> = {};
    if (!eq(o.owners, a.owners)) desiredFields.owners = a.owners;
    if (!eq(o.beneficiaries, a.beneficiaries)) desiredFields.beneficiaries = a.beneficiaries;

    if (Object.keys(desiredFields).length === 0) continue;

    changes.push({
      description: `${a.name ?? "Account"} — ${Object.keys(desiredFields).join(" + ")}`,
      edit: { op: "edit", targetKind: "account", targetId: a.id, desiredFields },
    });
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  // EntitySummary has optional `owners` (business-entity ownership) and
  // optional `beneficiaries` (trust beneficiary designations). Both are
  // compared when present; undefined is treated as equivalent to null.

  const origEnt = new Map((original.entities ?? []).map((e) => [e.id, e]));
  for (const e of working.entities ?? []) {
    const o = origEnt.get(e.id);
    if (!o) continue; // skip adds

    const desiredFields: Record<string, unknown> = {};
    if (!eq(o.owners, e.owners)) desiredFields.owners = e.owners;
    if (!eq(o.beneficiaries, e.beneficiaries)) desiredFields.beneficiaries = e.beneficiaries;

    if (Object.keys(desiredFields).length === 0) continue;

    changes.push({
      description: `${e.name ?? "Entity"} — ${Object.keys(desiredFields).join(" + ")}`,
      edit: { op: "edit", targetKind: "entity", targetId: e.id, desiredFields },
    });
  }

  // ── Wills ────────────────────────────────────────────────────────────────
  // bequests and residuaryRecipients are always emitted together in desiredFields
  // (they are tightly coupled in the will editor and the overlay writer).

  const members = working.familyMembers ?? [];
  const clientName =
    members.find((m) => m.role === "client")?.firstName ?? "Client";
  const spouseName =
    members.find((m) => m.role === "spouse")?.firstName ?? "Spouse";

  const origWill = new Map((original.wills ?? []).map((w) => [w.id, w]));
  for (const w of working.wills ?? []) {
    const o = origWill.get(w.id);
    if (!o) continue; // skip adds

    if (eq(o.bequests, w.bequests) && eq(o.residuaryRecipients, w.residuaryRecipients)) {
      continue;
    }

    const grantorName =
      w.grantor === "client" ? clientName
      : w.grantor === "spouse" ? spouseName
      : (w.grantor ?? "?");

    changes.push({
      description: `Will (${grantorName}) — distribution`,
      edit: {
        op: "edit",
        targetKind: "will",
        targetId: w.id,
        desiredFields: {
          bequests: w.bequests,
          residuaryRecipients: w.residuaryRecipients,
        },
      },
    });
  }

  return changes;
}
