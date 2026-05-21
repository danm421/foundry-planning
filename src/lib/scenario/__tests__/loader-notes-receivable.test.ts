// src/lib/scenario/__tests__/loader-notes-receivable.test.ts
//
// Integration test for the notesReceivable filter inside loadEffectiveTree.
// Hits the live Neon dev branch via Drizzle. Patterned after
// `src/lib/loaders/__tests__/notes-receivable.test.ts` (Task 2).
//
// The filter rule under test:
//   - note.toggleGroupId == null         -> always passes
//   - note.toggleGroupId == gid          -> passes iff
//                                            (toggleState[gid] ?? group.defaultOn) === true
//
// Architecture quirks worth noting:
//   - loadClientDataWithContext (cached) loads notesReceivable for the BASE
//     scenario only. So our notes are inserted with scenarioId = baseScenario.id
//     but their toggleGroupId can point at toggle groups attached to a fresh
//     non-base scenario (no DB constraint couples them).
//   - We always pass a non-base scenario id to loadEffectiveTree so the fast
//     path (isBaseCase && empty toggleState) doesn't short-circuit the filter.
//
import { randomUUID } from "node:crypto";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

// vitest.setup.ts already loads .env.local before any test file imports.
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";

d("loadEffectiveTree — notesReceivable filter by ToggleState", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let drizzleOrm: typeof import("drizzle-orm");
  let loaderMod: typeof import("../loader");

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    drizzleOrm = await import("drizzle-orm");
    loaderMod = await import("../loader");
  });

  // Track everything we created so cleanup deletes only our own rows.
  // Cascade on scenarios → scenario_toggle_groups handles the groups.
  // Notes live on the BASE scenario so are NOT cascade-cleaned; we track
  // and delete them explicitly. Cascade on notesReceivable handles owners.
  const createdScenarioIds: string[] = [];
  const createdNoteIds: string[] = [];
  const createdExternalBeneficiaryIds: string[] = [];

  let baseScenarioId: string;

  beforeAll(async () => {
    const { db } = dbMod;
    const { scenarios } = schema;
    const { and, eq } = drizzleOrm;
    const [base] = await db
      .select()
      .from(scenarios)
      .where(
        and(
          eq(scenarios.clientId, COOPER_CLIENT_ID),
          eq(scenarios.isBaseCase, true),
        ),
      );
    if (!base) {
      throw new Error(
        `Test fixture missing: client ${COOPER_CLIENT_ID} has no base case scenario`,
      );
    }
    baseScenarioId = base.id;
  });

  beforeEach(() => {
    createdScenarioIds.length = 0;
    createdNoteIds.length = 0;
    createdExternalBeneficiaryIds.length = 0;
  });

  afterEach(async () => {
    const { db } = dbMod;
    const { scenarios, externalBeneficiaries, notesReceivable } = schema;
    const { eq, inArray } = drizzleOrm;
    if (createdNoteIds.length > 0) {
      await db
        .delete(notesReceivable)
        .where(inArray(notesReceivable.id, createdNoteIds));
    }
    for (const id of createdScenarioIds) {
      await db.delete(scenarios).where(eq(scenarios.id, id));
    }
    for (const id of createdExternalBeneficiaryIds) {
      await db
        .delete(externalBeneficiaries)
        .where(eq(externalBeneficiaries.id, id));
    }
  });

  it("drops notes whose toggle group is off in toggleState", async () => {
    const { db } = dbMod;
    const {
      scenarios,
      scenarioToggleGroups,
      notesReceivable,
      noteReceivableOwners,
      externalBeneficiaries,
    } = schema;

    // Fresh non-base scenario carries the toggle groups (and ensures the
    // fast-path short-circuit in loadEffectiveTree does NOT fire).
    const [scn] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-filter-A-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    createdScenarioIds.push(scn.id);

    // Two toggle groups, both defaulting on. We'll override one of them to
    // off in the toggleState passed to loadEffectiveTree.
    const [groupOn, groupOff] = await db
      .insert(scenarioToggleGroups)
      .values([
        {
          scenarioId: scn.id,
          name: "test-group-on",
          defaultOn: true,
          orderIndex: 0,
        },
        {
          scenarioId: scn.id,
          name: "test-group-off",
          defaultOn: true,
          orderIndex: 1,
        },
      ])
      .returning();

    // Shared owner for all three notes — external beneficiary keeps the
    // test self-contained.
    const [extBen] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-filter-ben-${randomUUID().slice(0, 6)}`,
        kind: "charity",
      })
      .returning();
    createdExternalBeneficiaryIds.push(extBen.id);

    // Three notes scoped to the BASE scenario (because loadClientDataWithContext
    // only loads base-scenario notes). The toggleGroupId references the
    // fresh non-base scenario's toggle groups — no FK constraint couples
    // scenario_id between the note and its toggle group.
    const noteRows = await db
      .insert(notesReceivable)
      .values([
        {
          clientId: COOPER_CLIENT_ID,
          scenarioId: baseScenarioId,
          toggleGroupId: null,
          name: "Untoggled",
          faceValue: "100000",
          basis: "100000",
          interestRate: "0.05",
          paymentType: "amortizing",
          startYear: 2026,
          startMonth: 1,
          termMonths: 120,
        },
        {
          clientId: COOPER_CLIENT_ID,
          scenarioId: baseScenarioId,
          toggleGroupId: groupOn.id,
          name: "On note",
          faceValue: "100000",
          basis: "100000",
          interestRate: "0.05",
          paymentType: "amortizing",
          startYear: 2026,
          startMonth: 1,
          termMonths: 120,
        },
        {
          clientId: COOPER_CLIENT_ID,
          scenarioId: baseScenarioId,
          toggleGroupId: groupOff.id,
          name: "Off note",
          faceValue: "100000",
          basis: "100000",
          interestRate: "0.05",
          paymentType: "amortizing",
          startYear: 2026,
          startMonth: 1,
          termMonths: 120,
        },
      ])
      .returning();
    for (const r of noteRows) createdNoteIds.push(r.id);

    await db.insert(noteReceivableOwners).values(
      noteRows.map((r) => ({
        noteReceivableId: r.id,
        externalBeneficiaryId: extBen.id,
        percent: "1.0000",
      })),
    );

    const { effectiveTree } = await loaderMod.loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scn.id,
      { [groupOff.id]: false },
    );

    const ourNoteIdSet = new Set(noteRows.map((r) => r.id));
    const ourNotes = (effectiveTree.notesReceivable ?? []).filter((n) =>
      ourNoteIdSet.has(n.id),
    );
    const names = ourNotes.map((n) => n.name).sort();
    expect(names).toEqual(["On note", "Untoggled"]);
  });

  it("respects group.defaultOn when toggleState has no entry for the group", async () => {
    const { db } = dbMod;
    const {
      scenarios,
      scenarioToggleGroups,
      notesReceivable,
      noteReceivableOwners,
      externalBeneficiaries,
    } = schema;

    const [scn] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-filter-B-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    createdScenarioIds.push(scn.id);

    // Group with defaultOn=false. Also create an unrelated group used only
    // to keep toggleState non-empty (avoids the base-case fast path — though
    // this scenario is non-base, defensive belt-and-suspenders).
    const [defaultOffGroup, unrelatedGroup] = await db
      .insert(scenarioToggleGroups)
      .values([
        {
          scenarioId: scn.id,
          name: "default-off-group",
          defaultOn: false,
          orderIndex: 0,
        },
        {
          scenarioId: scn.id,
          name: "unrelated-sentinel",
          defaultOn: true,
          orderIndex: 1,
        },
      ])
      .returning();

    const [extBen] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-filter-ben-${randomUUID().slice(0, 6)}`,
        kind: "charity",
      })
      .returning();
    createdExternalBeneficiaryIds.push(extBen.id);

    const [note] = await db
      .insert(notesReceivable)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId: baseScenarioId,
        toggleGroupId: defaultOffGroup.id,
        name: "Default-off note",
        faceValue: "50000",
        basis: "50000",
        interestRate: "0.04",
        paymentType: "interest_only_balloon",
        startYear: 2027,
        startMonth: 6,
        termMonths: 60,
      })
      .returning();
    createdNoteIds.push(note.id);

    await db.insert(noteReceivableOwners).values({
      noteReceivableId: note.id,
      externalBeneficiaryId: extBen.id,
      percent: "1.0000",
    });

    // toggleState has an entry for the unrelated group only — the target
    // group has no override, so the filter should fall back to its
    // defaultOn=false and drop the note.
    const { effectiveTree } = await loaderMod.loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scn.id,
      { [unrelatedGroup.id]: true },
    );

    const ourNote = (effectiveTree.notesReceivable ?? []).find(
      (n) => n.id === note.id,
    );
    expect(ourNote).toBeUndefined();
  });

  it("fast-path: base scenario with empty toggleState drops notes that have a non-null toggleGroupId", async () => {
    const { db } = dbMod;
    const {
      scenarios,
      scenarioToggleGroups,
      notesReceivable,
      noteReceivableOwners,
      externalBeneficiaries,
    } = schema;

    // Create a non-base scenario to host a toggle group. The toggle group
    // must exist (FK enforces existence) before we can attach a note to it.
    // The fast-path filter doesn't *load* groups — it just drops any note
    // with a non-null toggleGroupId — but the row insert still requires a
    // real group_id.
    const [hostScn] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-fast-path-host-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    createdScenarioIds.push(hostScn.id);

    const [grp] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId: hostScn.id,
        name: "fast-path-group",
        defaultOn: true,
        orderIndex: 0,
      })
      .returning();

    const [extBen] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-fast-path-ben-${randomUUID().slice(0, 6)}`,
        kind: "charity",
      })
      .returning();
    createdExternalBeneficiaryIds.push(extBen.id);

    // Two notes scoped to the BASE scenario. One has toggleGroupId=null
    // (must appear), the other has toggleGroupId pointing at the group on
    // the non-base host scenario (must NOT appear in the base view).
    const noteRows = await db
      .insert(notesReceivable)
      .values([
        {
          clientId: COOPER_CLIENT_ID,
          scenarioId: baseScenarioId,
          toggleGroupId: null,
          name: "Fast-path null-toggle note",
          faceValue: "100000",
          basis: "100000",
          interestRate: "0.05",
          paymentType: "amortizing",
          startYear: 2026,
          startMonth: 1,
          termMonths: 120,
        },
        {
          clientId: COOPER_CLIENT_ID,
          scenarioId: baseScenarioId,
          toggleGroupId: grp.id,
          name: "Fast-path grouped note",
          faceValue: "100000",
          basis: "100000",
          interestRate: "0.05",
          paymentType: "amortizing",
          startYear: 2026,
          startMonth: 1,
          termMonths: 120,
        },
      ])
      .returning();
    for (const r of noteRows) createdNoteIds.push(r.id);

    await db.insert(noteReceivableOwners).values(
      noteRows.map((r) => ({
        noteReceivableId: r.id,
        externalBeneficiaryId: extBen.id,
        percent: "1.0000",
      })),
    );

    // Hit the base scenario with empty toggleState → fast path fires.
    const { effectiveTree } = await loaderMod.loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      baseScenarioId,
      {},
    );

    const ourNoteIdSet = new Set(noteRows.map((r) => r.id));
    const ourNotes = (effectiveTree.notesReceivable ?? []).filter((n) =>
      ourNoteIdSet.has(n.id),
    );
    const names = ourNotes.map((n) => n.name).sort();
    expect(names).toEqual(["Fast-path null-toggle note"]);
  });

  it("drops notes whose toggle group's parent is off via requiresGroupId", async () => {
    const { db } = dbMod;
    const {
      scenarios,
      scenarioToggleGroups,
      notesReceivable,
      noteReceivableOwners,
      externalBeneficiaries,
    } = schema;

    // Regression for a code-review-caught bug: the previous filter resolved
    // each group's state independently (toggleState ?? defaultOn), ignoring
    // `requiresGroupId` parent-chain cascading. A note attached to a child
    // group whose parent is off would incorrectly pass.
    const [scn] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-filter-C-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    createdScenarioIds.push(scn.id);

    // Parent + child groups, both default-on. We'll override parent → off in
    // toggleState; `resolveEffectiveToggleState` must propagate that down to
    // the child even though the child itself has no explicit override.
    const [parentGroup] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId: scn.id,
        name: "parent-group",
        defaultOn: true,
        orderIndex: 0,
        requiresGroupId: null,
      })
      .returning();
    const [childGroup] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId: scn.id,
        name: "child-group",
        defaultOn: true,
        orderIndex: 1,
        requiresGroupId: parentGroup.id,
      })
      .returning();

    const [extBen] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-filter-ben-${randomUUID().slice(0, 6)}`,
        kind: "charity",
      })
      .returning();
    createdExternalBeneficiaryIds.push(extBen.id);

    const [note] = await db
      .insert(notesReceivable)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId: baseScenarioId,
        toggleGroupId: childGroup.id,
        name: "Child-of-off-parent note",
        faceValue: "75000",
        basis: "75000",
        interestRate: "0.045",
        paymentType: "amortizing",
        startYear: 2028,
        startMonth: 3,
        termMonths: 84,
      })
      .returning();
    createdNoteIds.push(note.id);

    await db.insert(noteReceivableOwners).values({
      noteReceivableId: note.id,
      externalBeneficiaryId: extBen.id,
      percent: "1.0000",
    });

    // Parent → off. Child has no explicit override, but its effective state
    // must cascade to off, so the note must be filtered out.
    const { effectiveTree } = await loaderMod.loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scn.id,
      { [parentGroup.id]: false },
    );

    const ourNote = (effectiveTree.notesReceivable ?? []).find(
      (n) => n.id === note.id,
    );
    expect(ourNote).toBeUndefined();
  });
});
