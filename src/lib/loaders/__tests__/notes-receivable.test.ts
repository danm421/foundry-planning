// src/lib/loaders/__tests__/notes-receivable.test.ts
//
// Integration test for loadNotesReceivable. Hits the live Neon dev branch via
// Drizzle. Patterned after
// `src/app/api/clients/[id]/scenarios/[sid]/toggle-groups/__tests__/route.test.ts`.
//
// Skips when DATABASE_URL is unset.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

// Load .env.local before importing anything that reads DATABASE_URL.
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local missing — describe.skipIf below handles it.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";

d("loadNotesReceivable — toggleGroupId propagation", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let drizzleOrm: typeof import("drizzle-orm");
  let loader: typeof import("../notes-receivable");

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    drizzleOrm = await import("drizzle-orm");
    loader = await import("../notes-receivable");
  });

  // Track every scenario/external-beneficiary we created so cleanup deletes
  // only our own rows. Cascade on scenarios → scenario_toggle_groups,
  // notes_receivable, and note_receivable_owners handles the rest.
  const createdScenarioIds: string[] = [];
  const createdExternalBeneficiaryIds: string[] = [];
  let scenarioId: string;

  beforeEach(async () => {
    createdScenarioIds.length = 0;
    createdExternalBeneficiaryIds.length = 0;

    const { db } = dbMod;
    const { scenarios } = schema;
    const [row] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-loader-test-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = row.id;
    createdScenarioIds.push(row.id);
  });

  afterEach(async () => {
    const { db } = dbMod;
    const { scenarios, externalBeneficiaries } = schema;
    const { eq } = drizzleOrm;
    for (const id of createdScenarioIds) {
      await db.delete(scenarios).where(eq(scenarios.id, id));
    }
    for (const id of createdExternalBeneficiaryIds) {
      await db.delete(externalBeneficiaries).where(eq(externalBeneficiaries.id, id));
    }
  });

  it("propagates toggleGroupId from the DB row to the engine NoteReceivable shape", async () => {
    const { db } = dbMod;
    const {
      scenarioToggleGroups,
      notesReceivable,
      noteReceivableOwners,
      externalBeneficiaries,
    } = schema;

    // Owner shared by both notes — external beneficiary keeps the test
    // self-contained (no dependency on a specific family member fixture).
    const [extBen] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `nr-loader-test-ben-${randomUUID().slice(0, 6)}`,
        kind: "charity",
      })
      .returning();
    createdExternalBeneficiaryIds.push(extBen.id);

    // Toggle group attached to the scenario.
    const [group] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId,
        name: "test-group",
        defaultOn: true,
        orderIndex: 0,
      })
      .returning();

    // Two notes: one with toggleGroupId set, one with it null.
    const [noteWithGroup] = await db
      .insert(notesReceivable)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId,
        toggleGroupId: group.id,
        name: "note-with-group",
        faceValue: "100000",
        basis: "100000",
        interestRate: "0.05",
        paymentType: "amortizing",
        startYear: 2026,
        startMonth: 1,
        termMonths: 120,
      })
      .returning();

    const [noteWithoutGroup] = await db
      .insert(notesReceivable)
      .values({
        clientId: COOPER_CLIENT_ID,
        scenarioId,
        // toggleGroupId omitted → NULL
        name: "note-without-group",
        faceValue: "50000",
        basis: "50000",
        interestRate: "0.04",
        paymentType: "interest_only_balloon",
        startYear: 2027,
        startMonth: 6,
        termMonths: 60,
      })
      .returning();

    // Required owner row per note (loader filters by noteReceivableId).
    await db.insert(noteReceivableOwners).values([
      {
        noteReceivableId: noteWithGroup.id,
        externalBeneficiaryId: extBen.id,
        percent: "1.0000",
      },
      {
        noteReceivableId: noteWithoutGroup.id,
        externalBeneficiaryId: extBen.id,
        percent: "1.0000",
      },
    ]);

    const notes = await loader.loadNotesReceivable(COOPER_CLIENT_ID, scenarioId);

    expect(notes).toHaveLength(2);

    const grouped = notes.find((n) => n.id === noteWithGroup.id);
    const ungrouped = notes.find((n) => n.id === noteWithoutGroup.id);

    expect(grouped).toBeDefined();
    expect(ungrouped).toBeDefined();
    expect(grouped!.toggleGroupId).toBe(group.id);
    expect(ungrouped!.toggleGroupId).toBeNull();
  });
});
