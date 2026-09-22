import { describe, expect, it } from "vitest";

import { accounts, liabilities } from "@/db/schema";

import { emptyImportPayload, type ImportPayload } from "../../types";
import { commitLiabilities } from "../liabilities";
import type { CommitContext } from "../types";

const CTX: CommitContext = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
};

type PropertyRow = { id: string; name: string; propertyAddress?: string | null };
/** What the DB already holds for a debt — only the link is read (Task 13 fix wave). */
type StoredLiability = { id: string; linkedPropertyId: string | null };

/**
 * Minimal tx double, mirroring commit/__tests__/savings.test.ts's `fakeTx`:
 * records inserts and updates, and answers the two SELECTs
 * `commitLiabilities` makes.
 *
 * The selects are discriminated BY TABLE: one is the household's
 * family-members lookup (`loadFamilyRoleIds`), the other the real-estate
 * property lookup. Answering both from one list would let a property row
 * masquerade as a family member and pull a liability_owners insert into
 * `inserted`, which the row-count assertions below would then miscount.
 */
function fakeTx(properties: PropertyRow[] = [], storedLiabilities: StoredLiability[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  let nextId = 0;
  const tx = {
    // `.returning()` is required: commitLiabilities reads the new row's id to
    // write its owner row and to stamp the link back onto the payload.
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        // LIABILITY rows only. `liability_owners` inserts come through this
        // same double, so pooling every table would inflate the row counts
        // below the moment the household has a role='client' member — and the
        // `rowIds` count is the assertion this whole task rests on.
        if (table === liabilities) {
          inserted.push(v);
          nextId += 1;
        }
        const rows = [{ id: `liability-${nextId}` }];
        return Object.assign(Promise.resolve(), { returning: async () => rows });
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          updated.push(v);
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === accounts) return properties;
          // The stored debts, for the UPDATE branch's fill-only-a-hole link
          // read. Still discriminated BY TABLE: pooling these with the
          // properties would let a debt answer the property lookup.
          if (table === liabilities) return storedLiabilities;
          return [];
        },
      }),
    }),
  };
  return { tx: tx as never, inserted, updated };
}

function payloadWith(liabilities: ImportPayload["liabilities"]): ImportPayload {
  return { ...emptyImportPayload(), liabilities };
}

/** Fresh every call: `linkCreated` mutates `match` on the rows it commits. */
function twoRows(): ImportPayload["liabilities"] {
  return [
    {
      name: "Mortgage",
      balance: 412_000,
      __rowId: "liability:mortgage#f1:0",
      match: { kind: "new" },
    },
    {
      name: "Auto Loan",
      balance: 18_000,
      __rowId: "liability:auto#f1:1",
      match: { kind: "new" },
    },
  ];
}

describe("commitLiabilities", () => {
  it("commits only the rows named in ctx.rowIds", async () => {
    const { tx, inserted } = fakeTx();
    await commitLiabilities(tx, payloadWith(twoRows()), {
      ...CTX,
      rowIds: ["liability:mortgage#f1:0"],
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].name).toBe("Mortgage");
  });

  it("commits everything when rowIds is absent (the wizard's behaviour)", async () => {
    const { tx, inserted } = fakeTx();
    await commitLiabilities(tx, payloadWith(twoRows()), CTX);
    expect(inserted).toHaveLength(2);
  });

  it("derives the term from the as-of and maturity dates instead of 360", async () => {
    const { tx, inserted } = fakeTx();
    await commitLiabilities(
      tx,
      payloadWith([
        {
          name: "Mortgage",
          balance: 412_000,
          balanceAsOfDate: "2026-08-31",
          maturityDate: "2041-08-01",
          __rowId: "liability:mortgage#f1:0",
          match: { kind: "new" },
        },
      ]),
      CTX,
    );
    expect(inserted[0].termMonths).toBe(180);
    expect(inserted[0].startYear).toBe(2026);
    expect(inserted[0].startMonth).toBe(8);
    expect(inserted[0].balanceAsOfYear).toBe(2026);
    expect(inserted[0].balanceAsOfMonth).toBe(8);
  });

  // PRIORITY, not merely reachability. The name is chosen so the token scorer
  // has a real winner of its own: "Hudson Avenue Mortgage" strips the
  // instrument word to {hudson, avenue}, which scores 2 against prop-b's
  // "Hudson Avenue Home" and 0 against prop-a's "Beach House". So prop-b is
  // what the scorer returns, and prop-a can only win because the exact address
  // is consulted FIRST. A name like a bare "Mortgage" would tokenize to
  // nothing and prove only that the address leg links where tokens cannot.
  it("prefers the exactly-matching address over a property the name tokens score higher", async () => {
    const { tx, inserted } = fakeTx([
      { id: "prop-a", name: "Beach House", propertyAddress: "5304 Hudson Avenue" },
      { id: "prop-b", name: "Hudson Avenue Home", propertyAddress: null },
    ]);
    await commitLiabilities(
      tx,
      payloadWith([
        {
          name: "Hudson Avenue Mortgage",
          balance: 412_000,
          propertyAddress: "5304 Hudson Avenue",
          __rowId: "liability:mortgage#f1:0",
          match: { kind: "new" },
        },
      ]),
      CTX,
    );
    expect(inserted[0].linkedPropertyId).toBe("prop-a");
  });

  // Mostly a REGRESSION GUARD: the startYear assertion passed before deriving
  // the term too. The wizard's review step seeds a Start year on a hand-added
  // row and lets the advisor edit it, on rows that carry no dates at all — so
  // on such a row the typed year is the only start anchor anyone stated, and
  // deriving the term must not overwrite it with today.
  it("keeps an advisor-typed startYear on a row the document gave no dates for", async () => {
    const { tx, inserted } = fakeTx();
    await commitLiabilities(
      tx,
      payloadWith([
        {
          name: "Student Loan",
          balance: 42_000,
          startYear: 2019,
          __rowId: "liability:student#f1:0",
          match: { kind: "new" },
        },
      ]),
      CTX,
    );
    expect(inserted[0].startYear).toBe(2019);
    // The month must pair with that year, not with today. The review step
    // types a year and no month, so January — `start_month`'s own schema
    // default, and what this insert wrote before it derived anything. Today's
    // month would originate the loan up to 11 months late, moving every year's
    // interest/principal split (engine/liability-schedules.ts reads it).
    expect(inserted[0].startMonth).toBe(1);
    // No dates were stated, so nothing may be recorded as the statement's own.
    expect(inserted[0].balanceAsOfYear).toBeNull();
  });
});

/**
 * The UPDATE path re-reads a loan that is already in the database, so every
 * column it names overwrites a stored figure. `deriveLiabilityTerm` fills all
 * five schedule fields on every call — an absent maturity hands back the
 * 360-month PLACEHOLDER, an absent balance date a null as-of — so a re-read
 * may only write the cells its OWN dates support. Anything else replaces a
 * figure some document asserted with one nothing asserted (the spec's
 * derived-vs-asserted rule, which also decided Tasks 3 and 5).
 */
describe("commitLiabilities — a re-read only writes the schedule cells its dates support", () => {
  const EXISTING = { kind: "exact", existingId: "liability-existing-1" } as const;

  it("writes the start anchor and term from a maturity date, and leaves the stored balance date alone", async () => {
    const { tx, updated } = fakeTx();
    await commitLiabilities(
      tx,
      payloadWith([
        {
          name: "Mortgage",
          balance: 400_000,
          maturityDate: "2041-08-01",
          // No balanceAsOfDate — this re-read says nothing about WHEN the
          // balance was measured, so it must not erase what the last one did.
          __rowId: "liability:mortgage#f2:0",
          match: EXISTING,
        },
      ]),
      CTX,
    );
    // The anchor and the term are one pair: the term is measured FROM the
    // anchor, so they move together even when the anchor falls back to today —
    // which is what an undated balance does.
    const today = new Date();
    expect(updated[0].startYear).toBe(today.getUTCFullYear());
    expect(updated[0].startMonth).toBe(today.getUTCMonth() + 1);
    // Measured from that anchor to 2041-08, so ~179 months — emphatically not
    // the 360-month placeholder, which is the figure this gate exists to keep
    // out of the database.
    expect(updated[0].termMonths).toBeTypeOf("number");
    expect(updated[0].termMonths).not.toBe(360);
    // The KEYS must be absent, not null: a null would overwrite the stored
    // record of when this balance was last measured.
    expect(updated[0]).not.toHaveProperty("balanceAsOfYear");
    expect(updated[0]).not.toHaveProperty("balanceAsOfMonth");
  });

  it("records a new balance date without re-amortizing the loan over the 360-month placeholder", async () => {
    const { tx, updated } = fakeTx();
    await commitLiabilities(
      tx,
      payloadWith([
        {
          name: "Mortgage",
          balance: 395_000,
          balanceAsOfDate: "2026-11-30",
          // No maturityDate — so `deriveLiabilityTerm` returns the 360-month
          // fallback. This loan's stored term is 180 (a real one, read off an
          // earlier statement); writing 360 here would move its payoff date by
          // fifteen years. THE COLUMN MUST NOT APPEAR IN THE UPDATE AT ALL,
          // which is the only way the stored 180 survives.
          __rowId: "liability:mortgage#f3:0",
          match: EXISTING,
        },
      ]),
      CTX,
    );
    expect(updated[0]).not.toHaveProperty("termMonths");
    // The anchor moves only with the term, so it stays out too — the stored
    // start still pairs with the stored term.
    expect(updated[0]).not.toHaveProperty("startMonth");
    // The one thing this re-read did state:
    expect(updated[0].balanceAsOfYear).toBe(2026);
    expect(updated[0].balanceAsOfMonth).toBe(11);
  });

  it("writes all five schedule columns when the statement printed both dates", async () => {
    const { tx, updated } = fakeTx();
    await commitLiabilities(
      tx,
      payloadWith([
        {
          name: "Mortgage",
          balance: 400_000,
          balanceAsOfDate: "2026-08-31",
          maturityDate: "2041-08-01",
          __rowId: "liability:mortgage#f4:0",
          match: EXISTING,
        },
      ]),
      CTX,
    );
    expect(updated[0].startYear).toBe(2026);
    expect(updated[0].startMonth).toBe(8);
    expect(updated[0].balanceAsOfYear).toBe(2026);
    expect(updated[0].balanceAsOfMonth).toBe(8);
    expect(updated[0].termMonths).toBe(180);
  });
});

/**
 * ── Final review I1(b): re-commit as a working recovery ─────────────────
 *
 * Spec §7 has the review surface commit a synthesized property in the SAME
 * post as its mortgage. When that did not happen — the debt was committed
 * first, or from an older draft — the INSERT ran with no property to match and
 * `linked_property_id` landed NULL. The advisor's natural recovery is to
 * commit the house and hit Commit on the mortgage again, and until now that
 * wrote nothing at all and reported success: `render-rows.ts` still partitions
 * the debt into the unlinked bucket and the techniques screens will not retire
 * it when the house is sold.
 *
 * Filling only a HOLE is the whole rule. The Linked property dropdown on the
 * liability form is an advisor decision, including the decision to clear it.
 */
describe("commitLiabilities — a re-commit repairs a missing property link", () => {
  const EXISTING = { kind: "exact", existingId: "liability-existing-1" } as const;
  const HUDSON: PropertyRow = {
    id: "prop-hudson",
    name: "Hudson Avenue Home",
    propertyAddress: "5304 Hudson Avenue",
  };

  function reCommit(stored: StoredLiability[], properties: PropertyRow[] = [HUDSON]) {
    const { tx, updated } = fakeTx(properties, stored);
    return commitLiabilities(
      tx,
      payloadWith([
        {
          name: "Mortgage",
          balance: 400_000,
          propertyAddress: "5304 Hudson Avenue",
          __rowId: "liability:mortgage#f1:0",
          match: EXISTING,
        },
      ]),
      CTX,
    ).then(() => updated);
  }

  it("fills the link when the stored one is null", async () => {
    const updated = await reCommit([{ id: "liability-existing-1", linkedPropertyId: null }]);
    expect(updated[0].linkedPropertyId).toBe("prop-hudson");
  });

  /**
   * The KEY must be absent, not null and not the same id written again — an
   * advisor who moved this mortgage to another property owns that choice, and
   * a re-read of the same statement may not quietly undo it. Absence is also
   * what makes a second re-commit a no-op.
   */
  it("leaves a link the advisor already set completely alone", async () => {
    const updated = await reCommit([
      { id: "liability-existing-1", linkedPropertyId: "prop-somewhere-else" },
    ]);
    expect(updated[0]).not.toHaveProperty("linkedPropertyId");
  });

  /** Nothing to link to: the key stays out rather than writing an explicit null. */
  it("writes no link when no property matches", async () => {
    const updated = await reCommit([{ id: "liability-existing-1", linkedPropertyId: null }], []);
    expect(updated[0]).not.toHaveProperty("linkedPropertyId");
  });
});
