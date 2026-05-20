import type { BeneficiaryRef, ClientData, WillBequest } from "@/engine/types";
import type { ScenarioEdit } from "@/hooks/use-scenario-writer";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EstateFlowChange {
  /** Human-readable summary for the unsaved-changes list. */
  description: string;
  /**
   * The overlay edit to submit. `op: "edit"` carries `targetId` +
   * `desiredFields`; `op: "add"` carries `entity` instead. Wills are the only
   * estate-flow targetKind that supports adds today — the Remainder estate
   * dialog mints a new will when the household had none, and the diff must
   * surface that as an add so it flows through both save channels.
   */
  edit: ScenarioEdit & {
    op: "add" | "edit";
    targetKind: "account" | "entity" | "will";
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

/**
 * Bequest content with the persistence-only `id` dropped.
 *
 * The will PATCH route applies edits by delete+re-inserting every bequest, so
 * the database hands back a fresh `id` on every save. Comparing raw bequests
 * would then see those churned ids as a change and flag the will as
 * permanently dirty after a save — the "Unsaved changes" banner could never
 * clear. The diff only cares about the distribution *content*, so the id is
 * stripped before comparison. (Residuary recipients have no id, so they need
 * no equivalent treatment.)
 */
function bequestContent(bequests: WillBequest[] | undefined) {
  return (bequests ?? []).map((b) => {
    const copy: Partial<WillBequest> = { ...b };
    delete copy.id;
    return copy;
  });
}

/**
 * Beneficiary-designation content with the persistence-only `id` dropped.
 *
 * Both the account and entity `/beneficiaries` PUT routes apply edits by
 * delete+re-inserting every designation, so the database hands back fresh
 * `id`s on every save. Comparing raw beneficiaries would then see those
 * churned ids as a change and flag the account/entity as permanently dirty
 * after a save — the "Unsaved changes" banner could never clear, so a saved
 * beneficiary edit looks like it "did not save". The diff only cares about
 * the designation *content*, so the id is stripped before comparison.
 * Mirrors `bequestContent` for the will PATCH route.
 */
function beneficiaryContent(beneficiaries: BeneficiaryRef[] | undefined) {
  return (beneficiaries ?? []).map((b) => {
    const copy: Partial<BeneficiaryRef> = { ...b };
    delete copy.id;
    return copy;
  });
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
    if (!eq(beneficiaryContent(o.beneficiaries), beneficiaryContent(a.beneficiaries)))
      desiredFields.beneficiaries = a.beneficiaries;

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
    if (!eq(beneficiaryContent(o.beneficiaries), beneficiaryContent(e.beneficiaries)))
      desiredFields.beneficiaries = e.beneficiaries;

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
    const grantorName =
      w.grantor === "client" ? clientName
      : w.grantor === "spouse" ? spouseName
      : (w.grantor ?? "?");

    const o = origWill.get(w.id);
    if (!o) {
      // New will — the Remainder estate dialog mints one when the household
      // had no will yet. Suppress fully-empty new wills so a phantom upsert
      // doesn't flag the household dirty with a no-op.
      const bequests = w.bequests ?? [];
      const residuary = w.residuaryRecipients ?? [];
      if (bequests.length === 0 && residuary.length === 0) continue;

      changes.push({
        description: `Will (${grantorName}) — distribution`,
        edit: {
          op: "add",
          targetKind: "will",
          entity: {
            id: w.id,
            grantor: w.grantor,
            bequests,
            residuaryRecipients: residuary,
          },
        },
      });
      continue;
    }

    if (
      eq(bequestContent(o.bequests), bequestContent(w.bequests)) &&
      eq(o.residuaryRecipients, w.residuaryRecipients)
    ) {
      continue;
    }

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
