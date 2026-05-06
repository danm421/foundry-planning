import { describe, it, expect } from "vitest";

import {
  parseCompareSearchParams,
  parseEstateCompareSearchParams,
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
