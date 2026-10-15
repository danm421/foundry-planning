// src/lib/fact-finder/__tests__/change-set.test.ts
import { describe, expect, it } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { OBSERVATION_TOPICS } from "@/lib/schemas/observations";
import {
  TARGET_KINDS,
  defaultTicks,
  isRecordRef,
  lineIdOf,
  parseLineId,
  type ChangeField,
  type ChangeLine,
  type ChangeSet,
  type PlacedValue,
} from "../change-set";
import { NOTE_TOPICS, emptyRecordBook } from "../placement/types";

const field = (key: string, ticked: boolean): ChangeField => ({
  key,
  label: key,
  next: 1,
  shown: { next: "1" },
  ticked,
  from: [],
});

const line = (id: string, over: Partial<ChangeLine> = {}): ChangeLine => ({
  id,
  page: "accounts",
  sectionId: "cash",
  rowId: id.split("/")[0],
  target: "account",
  action: "create",
  recordId: null,
  label: id,
  fields: [],
  warnings: [],
  ...over,
});

describe("lineIdOf", () => {
  it("joins the row and the target, plus a number when one row makes several lines of a target", () => {
    expect(lineIdOf("r1", "account")).toBe("r1/account");
    expect(lineIdOf("r1", "plan_observation", 2)).toBe("r1/plan_observation/2");
    expect(lineIdOf("r1", "plan_observation", 0)).toBe("r1/plan_observation/0");
  });
});

describe("parseLineId", () => {
  it("reads back the row, target and number lineIdOf joined — a row id may hold slashes", () => {
    expect(parseLineId(lineIdOf("r1", "account"))).toEqual({ rowId: "r1", target: "account" });
    expect(parseLineId(lineIdOf("final_notes:Notes", "plan_observation", 0))).toEqual({ rowId: "final_notes:Notes", target: "plan_observation", n: 0 });
    expect(parseLineId(lineIdOf("a/b", "will_bequest", 12))).toEqual({ rowId: "a/b", target: "will_bequest", n: 12 });
  });

  it("is null for an id lineIdOf doesn't make", () => {
    for (const id of ["", "r1", "r1/not_a_target", "r1/Account", "/account/x"]) expect(parseLineId(id), id).toBeNull();
  });
});

describe("isRecordRef", () => {
  it("recognises each kind of ref", () => {
    expect(isRecordRef({ ref: "record", target: "account", id: "a1" })).toBe(true);
    expect(isRecordRef({ ref: "line", target: "liability", lineId: "r2/liability" })).toBe(true);
    expect(isRecordRef({ ref: "person", role: "client" })).toBe(true);
    expect(isRecordRef({ ref: "person", role: "spouse" })).toBe(true);
  });

  it("rejects plain values, lists, other objects and half-formed refs", () => {
    const others: (PlacedValue | undefined)[] = [
      null,
      undefined,
      "a1",
      3,
      true,
      [],
      [{ ref: "record", target: "account", id: "a1" }],
      { who: { ref: "person", role: "client" }, percent: 1 },
      { yearRef: "plan_end" },
      { ref: "record", target: "account" },
      { ref: "record", target: "not_a_target", id: "a1" },
      { ref: "line", target: "account" },
      { ref: "person", role: "child" },
      { ref: "other", id: "a1" },
    ];
    for (const value of others) expect(isRecordRef(value), JSON.stringify(value)).toBe(false);
  });
});

describe("defaultTicks", () => {
  it("takes each create and update field's own tick, and leaves out unchanged and blocked lines", () => {
    const changeSet: ChangeSet = {
      builtAtVersion: 5,
      builtAt: "2026-10-13T12:00:00.000Z",
      notices: [],
      lines: [
        line("r1/account", { fields: [field("name", true), field("value", true)] }),
        line("r2/account", { action: "update", recordId: "a2", fields: [field("name", false), field("value", true)] }),
        line("r3/account", { action: "none", recordId: "a3" }),
        line("r4/account", { fields: [field("value", true)], blocked: { reason: "Pick an owner." } }),
      ],
    };
    expect(defaultTicks(changeSet)).toEqual({
      "r1/account": { name: true, value: true },
      "r2/account": { name: false, value: true },
    });
  });
});

describe("the change set's vocabulary", () => {
  it("every target is a Details entity", () => {
    for (const target of TARGET_KINDS) expect(findEntity(target), target).toBeDefined();
  });

  it("note topics are the plan notes' topics", () => {
    expect([...NOTE_TOPICS]).toEqual([...OBSERVATION_TOPICS]);
  });

  it("an empty record book lists every target, with no base case and no people", () => {
    const book = emptyRecordBook("c1");
    expect(Object.keys(book.records).sort()).toEqual([...TARGET_KINDS].sort());
    expect(Object.values(book.records).every((records) => records.length === 0)).toBe(true);
    expect(book).toEqual({
      clientId: "c1",
      scenarioId: null,
      people: { client: null, spouse: null },
      names: { client: null, spouse: null },
      records: book.records,
    });
  });
});
