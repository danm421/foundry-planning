import { describe, it, expect } from "vitest";

import {
  parseCompareSearchParams,
  parseEstateCompareSearchParams,
  parsePlansSearchParam,
} from "../scenario-from-search-params";

describe("parseCompareSearchParams", () => {
  it("defaults left and right to base when params are absent", () => {
    const { left, right } = parseCompareSearchParams({});
    expect(left).toEqual({ kind: "scenario", id: "base", toggleState: {} });
    expect(right).toEqual({ kind: "scenario", id: "base", toggleState: {} });
  });

  it("recognizes the snap: prefix on the right side", () => {
    const { right } = parseCompareSearchParams({ right: "snap:abc-123" });
    expect(right).toEqual({ kind: "snapshot", id: "abc-123", side: "right" });
  });

  it("parses comma-separated toggles list onto the right side only", () => {
    const { left, right } = parseCompareSearchParams({
      left: "scn-l",
      right: "scn-r",
      toggles: "g1,g2,g3",
    });
    expect(left).toEqual({ kind: "scenario", id: "scn-l", toggleState: {} });
    expect(right).toEqual({
      kind: "scenario",
      id: "scn-r",
      toggleState: { g1: true, g2: true, g3: true },
    });
  });

  it("produces empty toggleState when toggles param is empty", () => {
    const { right } = parseCompareSearchParams({ right: "scn-r", toggles: "" });
    expect(right).toEqual({ kind: "scenario", id: "scn-r", toggleState: {} });
  });

  it("parses a plain scenario id (no snap: prefix) as a scenario kind ref", () => {
    const { left } = parseCompareSearchParams({ left: "scn-1" });
    expect(left).toEqual({ kind: "scenario", id: "scn-1", toggleState: {} });
  });

  it("recognizes the snap: prefix on the left side as well", () => {
    const { left } = parseCompareSearchParams({ left: "snap:left-snap" });
    expect(left).toEqual({ kind: "snapshot", id: "left-snap", side: "left" });
  });
});

describe("parseEstateCompareSearchParams", () => {
  it("returns base refs when both params are missing", () => {
    const { left, right } = parseEstateCompareSearchParams({});
    expect(left).toEqual({ kind: "scenario", id: "base", toggleState: {} });
    expect(right).toEqual({ kind: "scenario", id: "base", toggleState: {} });
  });

  it("recognizes `do-nothing` on either side", () => {
    const { left, right } = parseEstateCompareSearchParams({
      left: "do-nothing",
      right: "abc-123",
    });
    expect(left).toEqual({ kind: "do-nothing" });
    expect(right).toEqual({ kind: "scenario", id: "abc-123", toggleState: {} });
  });

  it("delegates non-sentinel values to parseCompareSearchParams", () => {
    const { left, right } = parseEstateCompareSearchParams({
      left: "snap:s1",
      right: "base",
      toggles: "g1,g2",
    });
    expect(left).toEqual({ kind: "snapshot", id: "s1", side: "left" });
    expect(right).toEqual({ kind: "scenario", id: "base", toggleState: {} });
  });
});

describe("parsePlansSearchParam", () => {
  it("defaults to [base, base] when neither plans nor legacy params are present", () => {
    const refs = parsePlansSearchParam({});
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ kind: "scenario", id: "base", toggleState: {} });
    expect(refs[1]).toEqual({ kind: "scenario", id: "base", toggleState: {} });
  });

  it("parses a 4-entry plans param in order", () => {
    const refs = parsePlansSearchParam({ plans: "base,sid_a,snap:s_b,sid_c" });
    expect(refs).toHaveLength(4);
    expect(refs[0]).toMatchObject({ kind: "scenario", id: "base" });
    expect(refs[1]).toMatchObject({ kind: "scenario", id: "sid_a" });
    expect(refs[2]).toMatchObject({ kind: "snapshot", id: "s_b" });
    expect(refs[3]).toMatchObject({ kind: "scenario", id: "sid_c" });
  });

  it("clamps plans with 5+ entries to the first 4", () => {
    const refs = parsePlansSearchParam({ plans: "base,a,b,c,d,e" });
    expect(refs).toHaveLength(4);
    expect(refs.map((r) => (r.kind === "scenario" ? r.id : `snap:${r.id}`))).toEqual([
      "base",
      "a",
      "b",
      "c",
    ]);
  });

  it("pads a 1-entry plans param up to 2 by appending base", () => {
    const refs = parsePlansSearchParam({ plans: "sid_a" });
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ kind: "scenario", id: "sid_a" });
    expect(refs[1]).toMatchObject({ kind: "scenario", id: "base" });
  });

  it("migrates legacy ?left=&right= when plans is absent", () => {
    const refs = parsePlansSearchParam({ left: "base", right: "sid_x" });
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ kind: "scenario", id: "base" });
    expect(refs[1]).toMatchObject({ kind: "scenario", id: "sid_x" });
  });

  it("prefers plans over legacy when both are present", () => {
    const refs = parsePlansSearchParam({
      plans: "base,sid_a,sid_b",
      left: "ignored",
      right: "ignored",
    });
    expect(refs).toHaveLength(3);
    expect(refs[1]).toMatchObject({ kind: "scenario", id: "sid_a" });
    expect(refs[2]).toMatchObject({ kind: "scenario", id: "sid_b" });
  });

  it("ignores empty tokens in the plans list", () => {
    const refs = parsePlansSearchParam({ plans: "base,,sid_a" });
    expect(refs).toHaveLength(2);
    expect(refs[1]).toMatchObject({ kind: "scenario", id: "sid_a" });
  });
});
