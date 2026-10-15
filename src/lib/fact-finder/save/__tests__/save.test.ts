// src/lib/fact-finder/save/__tests__/save.test.ts
//
// Live dev database: the save (Plan 4, Task 18) — a reviewed change list, with
// the advisor's ticks, written in ONE repeatable-read transaction and the
// import closed, or nothing written. Every writer is a fake that writes a plan
// note on the save's transaction and records its call, except the household's:
// that one is real, because the co-client it adds and the retirement it moves
// are what later lines' references must see. The review is the real one, run
// against the live plan. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_orchestrator", orgRole: "org:admin" }),
}));
// The real recordAudit, watched: the save's own row must ride its transaction.
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
});

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, clientImports, clients, familyMembers, planObservations } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { SAVE_CLOSED_MESSAGE, SAVE_FAILED_MESSAGE, SAVE_RACE_MESSAGE, SAVE_STALE_MESSAGE } from "../../api-types";
import { defaultTicks, TARGET_KINDS, type ChangeTicks } from "../../change-set";
import { loadFactFinder, type FactFinderScope } from "../../persist";
import { buildChangeSet } from "../../placement/build";
import { linkedTo, rowOf, stateWith } from "../../placement/__tests__/fixtures";
import { loadRecordBook } from "../../records/book";
import { saveChangeSet, type SaveDeps, type SaveRequest } from "../save";
import { SaveLineError, type SaveContext, type SaveInput, type SaveWriter } from "../types";
import { HOUSEHOLD_WRITERS } from "../writers/household";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_orchestrator";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const NOW = new Date("2026-10-15T12:00:00Z");

/**
 * Mark's fact finder: he retires at 62 and adds Laura (retiring at 63), a child, an ILIT that owns a
 * brokerage account, a home Laura owns with a mortgage on it, a car loan the review blocks (no loan
 * start), a new value for the household's cash account, and a salary each.
 */
function factFinder(cashId: string) {
  return stateWith({
    people: [
      rowOf("people:Client", { retirementAge: 62 }),
      rowOf("people:Co-client", { firstName: "Laura", lastName: "Hendricks", dateOfBirth: "1970-09-30", retirementAge: 63 }),
    ],
    family: [rowOf("f1", { firstName: "Emma", lastName: "Hendricks", relationship: "Child", dateOfBirth: "2004-05-01" })],
    cash: [rowOf("c1", { accountName: "Household Cash", currentValue: 15000 }, { link: linkedTo(cashId) })],
    taxable: [rowOf("tx1", { accountName: "ILIT Brokerage", currentValue: 50000, owner: "Trust / entity", ownerEntity: "Hendricks Family ILIT" })],
    realestate: [rowOf("re1", { propertyName: "Main home", propertyType: "Primary residence", currentValue: 600000, owner: "Co-client" })],
    liab: [
      rowOf("l1", { loanName: "Home mortgage", type: "Mortgage", owner: "Co-client", balance: 300000, interestRate: 6, loanStart: "2020-06", termYears: 30, propertyName: "Main home" }),
      rowOf("l2", { loanName: "Car loan", type: "Auto loan", owner: "Client", balance: 20000 }),
    ],
    salary: [rowOf("salary:Client", { annualSalary: 150000 }), rowOf("salary:Co-client", { annualSalary: 90000 })],
    trusts: [rowOf("t1", { trustName: "Hendricks Family ILIT", trustType: "ILIT", grantor: "Client" })],
  });
}

interface Reviewed {
  seed: SaveSeed;
  scope: FactFinderScope;
  cashId: string;
  ticks: ChangeTicks;
}

/** A new client whose fact finder the review has run over (no AI step) and stored on an import, as the review route leaves it. */
async function reviewed(opts: { coClient?: boolean } = {}): Promise<Reviewed> {
  const seed = await seedSaveClient(FIRM, opts);
  const book = await loadRecordBook(seed.clientId, FIRM, seed.scenarioId);
  const cashId = book.records.account.find((a) => a.label === "Household Cash")!.id;
  const state = factFinder(cashId);
  const changeSet = { ...(await buildChangeSet({ state, book, now: NOW, runLeftovers: async () => null })), builtAtVersion: 1 };
  const [imp] = await db
    .insert(clientImports)
    .values({ clientId: seed.clientId, orgId: FIRM, mode: "onboarding", createdByUserId: SAVE_ACTOR, payloadJson: { factFinder: { ...state, version: 1, changeSet } } })
    .returning({ id: clientImports.id });
  return { seed, scope: { importId: imp.id, clientId: seed.clientId, firmId: FIRM }, cashId, ticks: defaultTicks(changeSet) };
}

const request = (r: Reviewed, ticks: unknown = r.ticks): SaveRequest => ({ scope: r.scope, actorId: SAVE_ACTOR, changeSetVersion: 1, ticks });

interface Call {
  lineId: string;
  body: Record<string, unknown>;
  parentId: string | null;
  /** A Create's new id; an Update's record. */
  id: string;
}
type Hook = (ctx: SaveContext, input: SaveInput) => Promise<void>;

/**
 * Every target's writer as a fake that runs `hooks[lineId]` first, then writes a plan note on the save's
 * transaction and records the call (a Create returns the note's id) — the household's is the real writer.
 */
function writers(calls: Call[], hooks: Record<string, Hook> = {}): SaveDeps["writers"] {
  const record = (input: SaveInput, id: string) => calls.push({ lineId: input.line.id, body: input.body, parentId: input.parentId, id });
  const note = async (ctx: SaveContext, input: SaveInput): Promise<string> => {
    await hooks[input.line.id]?.(ctx, input);
    const [row] = await ctx.tx
      .insert(planObservations)
      .values({ clientId: ctx.clientId, section: "next_step", body: input.line.id })
      .returning({ id: planObservations.id });
    record(input, input.line.action === "create" ? row.id : input.recordId!);
    return row.id;
  };
  const fake: SaveWriter = { create: note, update: async (ctx, input) => void (await note(ctx, input)) };
  const household: SaveWriter = {
    create: HOUSEHOLD_WRITERS.client_household.create,
    async update(ctx, input) {
      await hooks[input.line.id]?.(ctx, input);
      await HOUSEHOLD_WRITERS.client_household.update(ctx, input);
      record(input, input.recordId!);
    },
  };
  return { ...Object.fromEntries(TARGET_KINDS.map((t) => [t, fake])), client_household: household } as SaveDeps["writers"];
}

const deps = (w: SaveDeps["writers"], extra: Partial<SaveDeps> = {}): Partial<SaveDeps> => ({
  writers: w, resolveHoldings: async () => new Map(), now: () => NOW, ...extra,
});

/** What's on the plan: the fakes' notes, the client's audit rows, Mark's retirement age, the co-client's family member. */
async function planOf(seed: SaveSeed) {
  const notes = await db.select({ body: planObservations.body }).from(planObservations).where(and(eq(planObservations.clientId, seed.clientId), eq(planObservations.section, "next_step")));
  const audit = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.clientId, seed.clientId));
  const [client] = await db.select({ retirementAge: clients.retirementAge }).from(clients).where(eq(clients.id, seed.clientId));
  const [spouse] = await db.select({ id: familyMembers.id }).from(familyMembers).where(and(eq(familyMembers.clientId, seed.clientId), eq(familyMembers.role, "spouse")));
  return { notes: notes.length, audit: audit.map((a) => a.action).sort(), retirementAge: client.retirementAge, spouseId: spouse?.id ?? null };
}

async function importOf(scope: FactFinderScope) {
  const [row] = await db.select({ status: clientImports.status, committedAt: clientImports.committedAt }).from(clientImports).where(eq(clientImports.id, scope.importId));
  return { ...row, factFinder: await loadFactFinder(scope) };
}

/** Nothing the save would write is on the plan, and the import is open with its change list, as reviewed. */
async function expectNothingWritten(r: Reviewed, retirementAge = 65) {
  expect(await planOf(r.seed)).toEqual({ notes: 0, audit: [], retirementAge, spouseId: null });
  const imp = await importOf(r.scope);
  expect(imp.status).toBe("draft");
  expect(imp.committedAt).toBeNull();
  expect(imp.factFinder?.closed).toBeUndefined();
  expect(imp.factFinder?.version).toBe(1);
  expect(imp.factFinder?.changeSet?.builtAtVersion).toBe(1);
}

/** The 3rd line in save order (Emma) throws `thrown`; a line before it queues work that must never run. */
async function failingAtTheThirdLine(thrown: Error) {
  const r = await reviewed();
  const calls: Call[] = [];
  const ran: string[] = [];
  const outcome = await saveChangeSet(
    request(r),
    deps(
      writers(calls, {
        "people:Client/client_household": async (ctx) => ctx.afterCommit(async () => void ran.push("queued work")),
        "f1/family_member": async () => {
          throw thrown;
        },
      }),
    ),
  );
  return { r, calls, ran, outcome };
}

d("saveChangeSet (live DB)", () => {
  beforeAll(async () => dropSaveFirm(FIRM));
  afterAll(async () => dropSaveFirm(FIRM));

  it("the reviewed change list the tests save: the household's two lines, seven Creates, one Update — and the car loan blocked", async () => {
    const r = await reviewed();
    const { changeSet } = (await loadFactFinder(r.scope))!;
    expect(changeSet!.lines.map((l) => [l.id, l.action, l.blocked?.reason ?? null])).toEqual([
      ["people:Client/client_household", "update", null],
      ["people:Co-client/client_household", "update", null],
      ["f1/family_member", "create", null],
      ["c1/account", "update", null],
      ["tx1/account", "create", null],
      ["re1/account", "create", null],
      ["l1/liability", "create", null],
      ["l2/liability", "create", "Needs Loan start."],
      ["salary:Client/income", "create", null],
      ["salary:Co-client/income", "create", null],
      ["t1/entity", "create", null],
    ]);
  });

  it("saves every ticked line in order — each reference resolved on the transaction — then closes the import; a second save writes nothing", async () => {
    const r = await reviewed();
    const calls: Call[] = [];
    const flushed: boolean[] = [];
    const ticks = { ...r.ticks, "c1/account": { value: false } };
    const outcome = await saveChangeSet(
      request(r, ticks),
      deps(
        writers(calls, {
          // Queued work runs after the commit: a fresh connection already sees the save's rows.
          "re1/account": async (ctx) => ctx.afterCommit(async () => void flushed.push((await planOf(r.seed)).notes > 0)),
        }),
      ),
    );
    expect(outcome.ok).toBe(true);

    // The household first, the trust before the account it owns, the home before its mortgage.
    expect(calls.map((c) => c.lineId)).toEqual([
      "people:Client/client_household", "people:Co-client/client_household", "f1/family_member", "t1/entity",
      "tx1/account", "re1/account", "l1/liability", "salary:Client/income", "salary:Co-client/income",
    ]);
    const call = (lineId: string) => calls.find((c) => c.lineId === lineId)!;
    const after = await planOf(r.seed);
    expect(after).toMatchObject({ notes: 7, retirementAge: 62 });
    const laura = after.spouseId;
    expect(laura).not.toBeNull();
    // A line ref → the id its line's writer returned; the co-client → the family member the household line added.
    expect(call("tx1/account").body.owners).toEqual([{ kind: "entity", entityId: call("t1/entity").id, percent: 1 }]);
    expect(call("re1/account").body.owners).toEqual([{ kind: "family_member", familyMemberId: laura, percent: 1 }]);
    expect(call("l1/liability").body).toMatchObject({ linkedPropertyId: call("re1/account").id, owners: [{ kind: "family_member", familyMemberId: laura, percent: 1 }] });
    // Milestones as the household lines left them: Mark retires in 2030 (1968 + 62), Laura in 2033 (1970 + 63); a salary ends the year before.
    expect(call("salary:Client/income").body).toMatchObject({ startYear: 2026, endYear: 2029, endYearRef: "client_retirement" });
    expect(call("salary:Co-client/income").body).toMatchObject({ startYear: 2026, endYear: 2032, endYearRef: "spouse_retirement" });
    expect(flushed).toEqual([true]);

    const imp = await importOf(r.scope);
    expect(imp.status).toBe("committed");
    expect(imp.committedAt?.toISOString()).toBe(NOW.toISOString());
    expect(imp.factFinder?.version).toBe(2);
    const lines = new Map(imp.factFinder!.changeSet!.lines.map((l) => [l.id, l]));
    expect(imp.factFinder?.closed).toEqual({
      at: NOW.toISOString(),
      by: SAVE_ACTOR,
      saved: calls.map((c) => ({ lineId: c.lineId, rowId: lines.get(c.lineId)!.rowId, target: lines.get(c.lineId)!.target, recordId: c.id, label: lines.get(c.lineId)!.label })),
      leftOut: [
        { lineId: "c1/account", rowId: "c1", label: "Household Cash", reason: "Nothing ticked." },
        { lineId: "l2/liability", rowId: "l2", label: "Car loan", reason: "Needs Loan start." },
      ],
    });
    expect(outcome).toEqual({ ok: true, factFinder: imp.factFinder });
    expect(call("people:Client/client_household").id).toBe(r.seed.clientId);

    // The save's own audit row, beside the household core's.
    expect(after.audit).toEqual(["client.update", "client.update", "import.fact_finder_saved"]);
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.resourceId, r.scope.importId), eq(auditLog.action, "import.fact_finder_saved")));
    expect(audit).toMatchObject({ firmId: FIRM, clientId: r.seed.clientId, actorId: SAVE_ACTOR, resourceType: "client_import" });
    expect(audit.metadata).toMatchObject({
      saved: 9, leftOut: 2, creates: 7, updates: 2,
      targets: { client_household: 2, family_member: 1, entity: 1, account: 2, liability: 1, income: 2 },
      ms: expect.any(Number),
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "import.fact_finder_saved", tx: expect.anything() }));

    expect(await saveChangeSet(request(r, ticks), deps(writers(calls)))).toEqual({ ok: false, status: 409, error: SAVE_CLOSED_MESSAGE, factFinder: imp.factFinder });
    expect(calls).toHaveLength(9);
  });

  it("a line the write path refuses (the 3rd) → 422 naming it; nothing on the plan, no audit row, the import still open", async () => {
    const { r, calls, ran, outcome } = await failingAtTheThirdLine(new SaveLineError("Pick a relationship."));
    expect(outcome).toEqual({ ok: false, status: 422, error: "Emma Hendricks: Pick a relationship.", lineId: "f1/family_member" });
    expect(calls.map((c) => c.lineId)).toEqual(["people:Client/client_household", "people:Co-client/client_household"]);
    expect(ran).toEqual([]);
    await expectNothingWritten(r);
  });

  it("anything else a writer throws → 500, logged with its line; nothing written", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { r, ran, outcome } = await failingAtTheThirdLine(new Error("connection reset"));
      expect(outcome).toEqual({ ok: false, status: 500, error: SAVE_FAILED_MESSAGE });
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("f1/family_member"), expect.anything());
      expect(ran).toEqual([]);
      await expectNothingWritten(r);
    } finally {
      logged.mockRestore();
    }
  });

  it("re-checks each written line with the advisor's ticks: a Create left without its first name → 422 before any write", async () => {
    const r = await reviewed();
    const calls: Call[] = [];
    const ticks = { ...r.ticks, "f1/family_member": { ...r.ticks["f1/family_member"], firstName: false } };
    expect(await saveChangeSet(request(r, ticks), deps(writers(calls)))).toEqual({
      ok: false, status: 422, error: "Emma Hendricks: Needs First name.", lineId: "f1/family_member",
    });
    expect(calls).toEqual([]);
    await expectNothingWritten(r);
  });

  it("ticks that don't match the change list, or a change list other than the one ticked → 409 before any write", async () => {
    const r = await reviewed();
    const calls: Call[] = [];
    expect(await saveChangeSet(request(r, { ...r.ticks, "l2/liability": { name: true } }), deps(writers(calls)))).toEqual({
      ok: false, status: 409, error: "The ticks don't match this change list — review again.",
    });
    expect(await saveChangeSet({ ...request(r), changeSetVersion: 2 }, deps(writers(calls)))).toEqual({
      ok: false, status: 409, error: SAVE_STALE_MESSAGE, factFinder: await loadFactFinder(r.scope),
    });
    expect(calls).toEqual([]);
    await expectNothingWritten(r);
  });

  it.each([
    {
      what: "a record edited in Details",
      edit: (r: Reviewed) => db.update(clients).set({ retirementAge: 64 }).where(eq(clients.id, r.seed.clientId)),
      refusal: { error: "“Client — Mark Hendricks” changed since you reviewed — review again.", lineId: "people:Client/client_household" },
      retirementAge: 64,
    },
    {
      what: "a linked record deleted in Details",
      edit: (r: Reviewed) => db.delete(accounts).where(eq(accounts.id, r.cashId)),
      refusal: { error: "“Household Cash” is no longer on the plan — review again.", lineId: "c1/account" },
      retirementAge: 65,
    },
  ])("$what after the review → 409 naming it; nothing written", async ({ edit, refusal, retirementAge }) => {
    const r = await reviewed();
    await edit(r);
    const calls: Call[] = [];
    expect(await saveChangeSet(request(r), deps(writers(calls)))).toEqual({ ok: false, status: 409, ...refusal });
    expect(calls).toEqual([]);
    await expectNothingWritten(r, retirementAge);
  });

  it("a Details edit that commits DURING the save to a record a later line writes → 409, nothing written, the edit kept", async () => {
    const r = await reviewed();
    const calls: Call[] = [];
    const outcome = await saveChangeSet(
      request(r),
      deps(
        writers(calls, {
          // The Details edit, on its own connection, committed at once: after the save's snapshot, before its write.
          "f1/family_member": async () => {
            await db.update(accounts).set({ notes: "edited in Details" }).where(eq(accounts.id, r.cashId));
          },
          // The save's write to the same row (the account line comes later in save order).
          "c1/account": async (ctx, input) => {
            await ctx.tx.update(accounts).set({ notes: "written by the save" }).where(eq(accounts.id, input.recordId!));
          },
        }),
      ),
    );
    expect(outcome).toEqual({ ok: false, status: 409, error: SAVE_RACE_MESSAGE });
    await expectNothingWritten(r);
    const [cash] = await db.select({ notes: accounts.notes }).from(accounts).where(eq(accounts.id, r.cashId));
    expect(cash.notes).toBe("edited in Details");
  });

  it("the co-client removed in Details between planning the save and its transaction → 409; no writer runs", async () => {
    const r = await reviewed({ coClient: true });
    const calls: Call[] = [];
    const outcome = await saveChangeSet(
      request(r),
      deps(writers(calls), {
        // The ticker pricing runs between the plan (made with the co-client) and the transaction.
        resolveHoldings: async () => {
          await db.delete(familyMembers).where(eq(familyMembers.id, r.seed.spouseMemberId!));
          return new Map();
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, status: 409, error: SAVE_RACE_MESSAGE });
    expect(calls).toEqual([]);
    await expectNothingWritten(r);
  });

  it("two saves at once: the second waits on the first's lock, then finds the import saved — one 200, one 409, nothing written twice", async () => {
    const r = await reviewed();
    const first: Call[] = [];
    const second: Call[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: (pid: number) => void;
    const inside = new Promise<number>((resolve) => (entered = resolve));
    const saving = saveChangeSet(
      request(r),
      deps(
        writers(first, {
          "f1/family_member": async (ctx) => {
            const { rows } = await ctx.tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
            entered(rows[0].pid);
            await held;
          },
        }),
      ),
    );
    const pid = await inside;
    // The second save's writers say so the moment any of them is reached.
    const reached: string[] = [];
    const reach = Object.fromEntries(Object.keys(r.ticks).map((id) => [id, async () => void reached.push(id)]));
    const again = saveChangeSet(request(r), deps(writers(second, reach)));
    // The second save's transaction is waiting on the first's row lock.
    await vi.waitFor(
      async () => {
        const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`);
        expect(rows[0].n).toBe(1);
      },
      { timeout: 30_000, interval: 100 },
    );
    release();
    const [a, b] = await Promise.all([saving, again]);
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, status: 409, error: SAVE_CLOSED_MESSAGE, factFinder: a.ok ? a.factFinder : null });
    expect(reached).toEqual([]);
    expect(second).toEqual([]);
    expect((await planOf(r.seed)).notes).toBe(first.length - 2);
  });
});
