import type { ClientData } from "@/engine/types";
import type { ScenarioEdit } from "@/hooks/use-scenario-writer";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EstateFlowChange {
  /** Human-readable summary for the unsaved-changes list. */
  description: string;
  /** The overlay edit to submit. Always op: "edit". */
  edit: ScenarioEdit & { op: "edit"; targetId: string; desiredFields: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Internal deep-equality helper
// ---------------------------------------------------------------------------

/**
 * Structural equality check using JSON serialisation.
 * Arrays here are plain JSON-serialisable fat fields (owners, beneficiaries,
 * bequests, residuaryRecipients) so this is both correct and cheap.
 * Treats `undefined` and `null` as equivalent (both serialise to `null`).
 */
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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

  const origWill = new Map((original.wills ?? []).map((w) => [w.id, w]));
  for (const w of working.wills ?? []) {
    const o = origWill.get(w.id);
    if (!o) continue; // skip adds

    if (eq(o.bequests, w.bequests) && eq(o.residuaryRecipients, w.residuaryRecipients)) {
      continue;
    }

    changes.push({
      description: `Will (${w.grantor ?? "?"}) — distribution`,
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
