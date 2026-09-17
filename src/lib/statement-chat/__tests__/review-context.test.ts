// src/lib/statement-chat/__tests__/review-context.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Column, Param, SQL, StringChunk, getTableColumns, getTableName } from "drizzle-orm";
import {
  accountOwners,
  accounts,
  clients,
  crmHouseholdContacts,
  entities,
  familyMembers,
  liabilities,
  scenarios,
} from "@/db/schema";

// Same posture as `map-entity-pass-scoping.test.ts` and `existing-rows.test.ts`:
// `@/db/schema` and `drizzle-orm` stay REAL, so every `where` below is the
// actual SQL object drizzle receives and the harness evaluates it against a
// fixture row rather than ignoring it. A read that lost its client leg would
// fail these tests, not pass them. Only `@/db` itself is replaced.

type Row = Record<string, unknown>;

const TABLES = [
  accountOwners,
  accounts,
  clients,
  crmHouseholdContacts,
  entities,
  familyMembers,
  liabilities,
  scenarios,
];

/** Column object -> the JS key it occupies on its table. */
const KEY_BY_COLUMN = new Map<Column, string>();
for (const table of TABLES) {
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    KEY_BY_COLUMN.set(column as Column, key);
  }
}

/** Walks a real `eq(column, value)` / `isNull(column)` / `and(...)` against a row. */
function matches(condition: SQL, row: Row): boolean {
  const chunks = condition.queryChunks;
  const nested = chunks.filter((c): c is SQL => c instanceof SQL);
  if (nested.length > 0) return nested.every((n) => matches(n, row));

  const column = chunks.find((c): c is Column => c instanceof Column);
  if (!column) throw new Error("expected a condition on one column");
  const key = KEY_BY_COLUMN.get(column);
  if (key === undefined) throw new Error(`unknown column ${column.name}`);
  const value = row[key];

  const text = chunks
    .filter((c): c is StringChunk => c instanceof StringChunk)
    .map((c) => c.value.join(""))
    .join("");
  if (/is null/i.test(text)) return value === null || value === undefined;

  const param = chunks.find((c): c is Param => c instanceof Param);
  if (!param) throw new Error("expected eq(column, value)");
  return value === param.value;
}

/** Mutable harness state, reset per test. Keyed by SQL table name. */
const state: { rows: Record<string, Row[]> } = { rows: {} };

/** Shape a fixture row the way the `db.select({ alias: column })` projection would. */
function project(fields: Record<string, Column>, row: Row): Row {
  const out: Row = {};
  for (const [alias, column] of Object.entries(fields)) {
    out[alias] = row[KEY_BY_COLUMN.get(column) ?? alias];
  }
  return out;
}

vi.mock("@/db", () => ({
  db: {
    select: (fields: Record<string, Column>) => ({
      from: (table: object) => {
        const name = getTableName(table as never);
        const builder = {
          // The join target never changes WHICH rows come back here — the
          // driving table's fixture does — but the `where` that follows is
          // still evaluated in full, which is the leg worth pinning.
          innerJoin: () => builder,
          leftJoin: () => builder,
          where: (condition: SQL) =>
            Promise.resolve(
              (state.rows[name] ?? [])
                .filter((row) => matches(condition, row))
                .map((row) => project(fields, row)),
            ),
        };
        return builder;
      },
    }),
  },
}));

import { EMPTY_CHAT_REVIEW_CONTEXT, loadChatReviewContext } from "../review-context";

beforeEach(() => {
  state.rows = {
    scenarios: [{ id: "s1", clientId: "client-1", isBaseCase: true }],
    clients: [
      // ADVERSARIAL ORDER, on purpose. Another household in the same firm sits
      // FIRST in every fixture below, so a read that lost its scoping leg takes
      // THIS row — and the assertions that name the scoping are what decide the
      // test, rather than the fixture happening to list the right row first.
      {
        id: "client-2",
        crmHouseholdId: "hh-2",
        retirementAge: 70,
        retirementMonth: 1,
        lifeExpectancy: 90,
        spouseRetirementAge: null,
        spouseRetirementMonth: null,
        spouseLifeExpectancy: null,
        filingStatus: "single",
        riskTolerance: null,
      },
      {
        id: "client-1",
        crmHouseholdId: "hh-1",
        retirementAge: 65,
        retirementMonth: 1,
        lifeExpectancy: 95,
        spouseRetirementAge: 63,
        spouseRetirementMonth: 6,
        spouseLifeExpectancy: 92,
        filingStatus: "married_joint",
        riskTolerance: "moderate",
      },
    ],
    crm_household_contacts: [
      // FIRST, so `find(role === "primary")` on an unscoped read returns
      // THIS contact and the scoping assertion below is the deciding one.
      {
        householdId: "hh-2",
        role: "primary",
        firstName: "Nobody",
        lastName: "Else",
        dateOfBirth: "1950-01-01",
        email: null,
        phone: null,
        mobile: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
      },
      {
        householdId: "hh-1",
        role: "primary",
        firstName: "Dana",
        lastName: "Reyes",
        dateOfBirth: "1968-03-04",
        email: "dana@example.com",
        phone: null,
        mobile: "(215) 555-0147",
        addressLine1: "12 Mill Road",
        addressLine2: null,
        city: "Wayne",
        state: "PA",
        postalCode: "19087",
        country: "US",
      },
      {
        householdId: "hh-1",
        role: "spouse",
        firstName: "Priya",
        lastName: "Reyes",
        dateOfBirth: "1970-11-22",
        email: null,
        phone: null,
        mobile: null,
        addressLine1: "12 Mill Road",
        addressLine2: null,
        city: "Wayne",
        state: "PA",
        postalCode: "19087",
        country: "US",
      },
    ],
    family_members: [],
    entities: [],
    accounts: [],
    account_owners: [],
    liabilities: [
      // ADVERSARIAL ORDER, same reasoning as the fixtures above: a row that
      // matches on only ONE scoping leg sits FIRST, so a read that dropped
      // either `clientId` or `scenarioId` picks it up and the single-element
      // assertion below actually pins both legs.
      {
        id: "liab-wrong-client",
        clientId: "client-2",
        scenarioId: "s1",
        name: "Nobody Else's Mortgage",
        balance: "999000.00",
      },
      {
        id: "liab-wrong-scenario",
        clientId: "client-1",
        scenarioId: "s-other",
        name: "Old Scenario Mortgage",
        balance: "888000.00",
      },
      {
        id: "liab-1",
        clientId: "client-1",
        scenarioId: "s1",
        name: "Mortgage",
        balance: "412000.00",
      },
    ],
  };
});

describe("loadChatReviewContext — the household's current values", () => {
  it("carries the household's current identity so the diff has a left column", async () => {
    const ctx = await loadChatReviewContext("client-1", null);
    expect(ctx.household).toMatchObject({ firstName: expect.any(String) });
  });

  it("keys the record by the same client_household field keys the map declares", async () => {
    const ctx = await loadChatReviewContext("client-1", null);
    expect(ctx.household).toMatchObject({
      // Primary contact, under the client's own keys.
      firstName: "Dana",
      lastName: "Reyes",
      dateOfBirth: "1968-03-04",
      mobile: "(215) 555-0147",
      addressLine1: "12 Mill Road",
      // Spouse contact, under the map's spouse-prefixed keys — NOT the
      // column names the CRM table uses.
      spouseName: "Priya",
      spouseLastName: "Reyes",
      spouseDob: "1970-11-22",
      // The clients row's own half of the PUT allowlist.
      retirementAge: 65,
      lifeExpectancy: 95,
      spouseLifeExpectancy: 92,
      filingStatus: "married_joint",
    });
  });

  it("reads only this client's household, never another's contacts", async () => {
    const ctx = await loadChatReviewContext("client-1", null);
    // The OTHER household's primary contact and clients row are FIRST in the
    // fixtures, so a read that lost its scoping leg takes them: "Nobody" and
    // a retirement age of 70. Asserted positively — `not.toBe("Nobody")` would
    // have been satisfied by fixture order alone.
    expect(ctx.household.firstName).toBe("Dana");
    expect(ctx.household.lastName).toBe("Reyes");
    expect(ctx.household.retirementAge).toBe(65);
  });

  it("answers an empty record for a client that does not resolve", async () => {
    const ctx = await loadChatReviewContext("client-missing", null);
    expect(ctx.household).toEqual({});
  });
});

describe("loadChatReviewContext — existing liabilities as match candidates", () => {
  it("loads the client's existing liabilities as match candidates", async () => {
    const ctx = await loadChatReviewContext("client-1", null);
    // The wrong-client and wrong-scenario rows sit FIRST in the fixture
    // (see beforeEach); a read that lost either scoping leg would pull one
    // of them in too, so this single-element assertion pins BOTH legs.
    expect(ctx.liabilities).toEqual([{ id: "liab-1", name: "Mortgage", balance: 412000 }]);
  });

  it("returns an empty liabilities list for a plan with none", async () => {
    expect(EMPTY_CHAT_REVIEW_CONTEXT.liabilities).toEqual([]);
  });
});
