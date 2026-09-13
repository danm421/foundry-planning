// src/lib/solver/__tests__/note-receivable-mutation.test.ts
//
// Backs the trust editor's Notes & sales tab (an IDGT installment sale).
// notes_receivable is scenario-partitioned with a NOT NULL scenario_id, so
// like entity flow overrides it is persisted by the save route, not by
// pushTechniqueUpsert.
import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { isBaseSavableMutation } from "@/lib/solver/mutations-to-base-updates";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import { mutationKey } from "@/lib/solver/types";
import type { ClientData } from "@/engine/types";
import type { NoteReceivable } from "@/engine/notes-receivable/types";

// paymentType uses the real notePaymentTypeEnum values (db/schema.ts:479):
// ["amortizing", "interest_only_balloon"]. The brief's fixture used the
// invalid "interest_only" — fixed here.
const note: NoteReceivable = {
  id: "note-1",
  name: "Sale to 2019 IDGT",
  faceValue: 1_000_000,
  basis: 400_000,
  interestRate: 0.042,
  paymentType: "interest_only_balloon",
  startYear: 2027,
  startMonth: 1,
  termMonths: 108,
  linkedTrustEntityId: "ent-idgt",
  toggleGroupId: null,
  extraPayments: [],
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

function tree(notes: NoteReceivable[]): ClientData {
  return {
    client: {} as never,
    accounts: [], savingsRules: [], incomes: [], expenses: [], liabilities: [],
    notesReceivable: notes,
    planSettings: {} as ClientData["planSettings"],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

describe("note-receivable-upsert — wire schema", () => {
  it("accepts an installment-sale note", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "note-receivable-upsert", id: note.id, value: note,
    }).success).toBe(true);
  });

  it("accepts a null value (remove)", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "note-receivable-upsert", id: note.id, value: null,
    }).success).toBe(true);
  });

  it("preserves the linked trust — the note is meaningless without it", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "note-receivable-upsert", id: note.id, value: note,
    });
    // Narrow on the discriminant rather than casting to `{ value: NoteReceivable }`
    // — the mutation union has members with no `value` field at all
    // (stress-inflation, life-expectancy, surplus-allocation), so that cast is
    // TS2352 and does not compile.
    const v = r.success && r.data.kind === "note-receivable-upsert" ? r.data.value : null;
    expect(v?.linkedTrustEntityId).toBe("ent-idgt");
  });

  it("rejects an invalid paymentType", () => {
    // The brief's own guess ("interest_only") must not parse — proof the
    // enum matches the real notePaymentTypeEnum, not the brief's guess.
    expect(SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "note-receivable-upsert",
      id: note.id,
      value: { ...note, paymentType: "interest_only" },
    }).success).toBe(false);
  });
});

describe("note-receivable-upsert — mutation key", () => {
  it("keys by note id", () => {
    expect(mutationKey({ kind: "note-receivable-upsert", id: "note-1", value: note }))
      .toBe("note-receivable-upsert:note-1");
  });
});

describe("applyMutations — note-receivable-upsert", () => {
  it("adds a note to the working tree", () => {
    const out = applyMutations(tree([]), [
      { kind: "note-receivable-upsert", id: note.id, value: note },
    ]);
    expect(out.notesReceivable).toHaveLength(1);
    expect(typeof out.notesReceivable?.[0].faceValue).toBe("number");
    // basis is the tightest-precision money column here (decimal(15,2), same
    // as faceValue) — interestRate is the tightest overall (decimal(7,4)), so
    // assert that one too: a string here would concatenate in the engine
    // (1 + "0.042" is "10.042"), a class of bug that has shipped to prod.
    expect(typeof out.notesReceivable?.[0].interestRate).toBe("number");
  });

  it("replaces a note by id", () => {
    const out = applyMutations(tree([note]), [
      { kind: "note-receivable-upsert", id: note.id, value: { ...note, faceValue: 1_200_000 } },
    ]);
    expect(out.notesReceivable).toHaveLength(1);
    expect(out.notesReceivable?.[0].faceValue).toBe(1_200_000);
  });

  it("removes a note when value is null", () => {
    const out = applyMutations(tree([note]), [
      { kind: "note-receivable-upsert", id: note.id, value: null },
    ]);
    expect(out.notesReceivable).toHaveLength(0);
  });
});

describe("note-receivable-upsert — persistence classification", () => {
  it("reports NOT base-savable", () => {
    expect(isBaseSavableMutation({
      kind: "note-receivable-upsert", id: note.id, value: note,
    })).toBe(false);
  });

  it("emits NO scenario change — the table is partitioned, not overlaid", () => {
    const drafts = mutationsToScenarioChanges(tree([]), "client-1", [
      { kind: "note-receivable-upsert", id: note.id, value: note },
    ]);
    expect(drafts).toHaveLength(0);
  });
});
