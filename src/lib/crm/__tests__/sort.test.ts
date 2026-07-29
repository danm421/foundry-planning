import { describe, it, expect } from "vitest";
import { resolveSort, clampTake, buildOrderBy, PAGE_SIZE } from "../sort";

describe("resolveSort — per-view defaults", () => {
  it("defaults the All view to last-name ascending", () => {
    expect(resolveSort("all", undefined, undefined)).toEqual({ key: "name", dir: "asc" });
  });

  it("leaves the Recently-opened view on its own ordering", () => {
    expect(resolveSort("recent", undefined, undefined).key).toBeNull();
  });

  it("leaves the Trash view on its own ordering", () => {
    expect(resolveSort("deleted", undefined, undefined).key).toBeNull();
  });
});

describe("resolveSort — untrusted input", () => {
  it("falls back to the view default when the key is not whitelisted", () => {
    expect(resolveSort("recent", "'; drop table crm_households;--", undefined).key).toBeNull();
  });

  it("falls back to the view default for an unknown key on the All view", () => {
    expect(resolveSort("all", "bogus", undefined)).toEqual({ key: "name", dir: "asc" });
  });

  it("uses the key's own default direction when dir is unrecognized", () => {
    expect(resolveSort("all", "updated", "sideways")).toEqual({ key: "updated", dir: "desc" });
  });

  it("honors an explicit valid direction", () => {
    expect(resolveSort("all", "name", "desc")).toEqual({ key: "name", dir: "desc" });
  });

  it("defaults Updated to descending but Name to ascending", () => {
    expect(resolveSort("all", "updated", undefined).dir).toBe("desc");
    expect(resolveSort("all", "name", undefined).dir).toBe("asc");
  });
});

describe("clampTake", () => {
  it("defaults to one page", () => {
    expect(clampTake(undefined)).toBe(PAGE_SIZE);
  });

  it("floors at one page", () => {
    expect(clampTake("0")).toBe(PAGE_SIZE);
    expect(clampTake("-5")).toBe(PAGE_SIZE);
  });

  it("ceilings at 1000 so a huge take cannot exhaust the server", () => {
    expect(clampTake("999999999")).toBe(1000);
  });

  it("ignores non-numeric input", () => {
    expect(clampTake("abc")).toBe(PAGE_SIZE);
  });

  it("passes a sane value through", () => {
    expect(clampTake("150")).toBe(150);
  });
});

describe("buildOrderBy", () => {
  it("appends a tie-break term to every key", () => {
    // name = last, first, id  |  status = status, id
    expect(buildOrderBy("name", "asc")).toHaveLength(3);
    expect(buildOrderBy("status", "asc")).toHaveLength(2);
    expect(buildOrderBy("updated", "desc")).toHaveLength(2);
    expect(buildOrderBy("primary", "asc")).toHaveLength(3);
    expect(buildOrderBy("spouse", "asc")).toHaveLength(3);
  });
});
