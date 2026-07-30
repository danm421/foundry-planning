import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  resolveSort,
  clampTake,
  shouldShowLoadMore,
  PAGE_SIZE,
  type ClientSortKey,
  type SortDir,
} from "../sort";
import { buildOrderBy } from "../sort-order";

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

describe("shouldShowLoadMore", () => {
  it("offers another page below the ceiling", () => {
    expect(shouldShowLoadMore(true, 950)).toBe(true);
  });

  it("hides the control AT the ceiling — raising take there is a no-op", () => {
    expect(shouldShowLoadMore(true, 1000)).toBe(false);
  });

  it("hides the control when there are no more rows below the ceiling", () => {
    expect(shouldShowLoadMore(false, 950)).toBe(false);
  });

  it("hides the control when there are no more rows at the ceiling", () => {
    expect(shouldShowLoadMore(false, 1000)).toBe(false);
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

// ---------------------------------------------------------------------------
// buildOrderBy — compiled SQL text
//
// The tests above only check term COUNT, which a mutation can preserve while
// breaking the two invariants the plan calls mandatory: nulls-last in BOTH
// directions, and a household-id tie-break on EVERY key. These tests compile
// each SQL fragment to text with PgDialect (no live DB / DATABASE_URL — see
// task-1-report.md fix-round-1 section for the standalone-compile check) and
// assert on the actual rendered SQL.
// ---------------------------------------------------------------------------

const dialect = new PgDialect();

/** Compiles each ORDER BY term for (key, dir) to its rendered SQL text. */
function orderByText(key: ClientSortKey, dir: SortDir): string[] {
  return buildOrderBy(key, dir).map((term) => dialect.sqlToQuery(term).sql);
}

const allKeys: ClientSortKey[] = ["name", "status", "primary", "spouse", "updated"];
const allDirs: SortDir[] = ["asc", "desc"];
const keyDirPairs: [ClientSortKey, SortDir][] = allKeys.flatMap((key) =>
  allDirs.map((dir): [ClientSortKey, SortDir] => [key, dir]),
);

describe("buildOrderBy — compiled SQL text", () => {
  // Point 1: every key, in both directions, ends on the household id
  // ascending — the tie-break is a fixed constant, not dir-dependent, so both
  // directions must be checked to catch a mutation that makes it follow dir.
  it.each(keyDirPairs)("ends the %s key's final term with the household id ascending (dir=%s)", (key, dir) => {
    const terms = orderByText(key, dir);
    expect(terms[terms.length - 1]).toBe('"crm_households"."id" asc');
  });

  // Point 2: nulls-last applies to every directional (non-tie-break) term, in
  // BOTH directions — the asymmetry the plan explicitly warns about (NOT
  // "nulls last on asc, nulls first on desc").
  it.each(keyDirPairs)("applies nulls-last to every directional term of %s (dir=%s)", (key, dir) => {
    const directional = orderByText(key, dir).slice(0, -1);
    expect(directional.every((term) => term.endsWith(`${dir} nulls last`))).toBe(true);
  });

  // Point 3: `name` and `primary` are deliberately different keys — name
  // sorts on last_name first, primary sorts on first_name first.
  it("name's leading term sorts on last_name", () => {
    const [leading] = orderByText("name", "asc");
    expect(leading).toContain("c.last_name");
  });

  it("name's second term sorts on first_name", () => {
    const [, second] = orderByText("name", "asc");
    expect(second).toContain("c.first_name");
  });

  it("primary's leading term sorts on first_name", () => {
    const [leading] = orderByText("primary", "asc");
    expect(leading).toContain("c.first_name");
  });

  it("primary's second term sorts on last_name", () => {
    const [, second] = orderByText("primary", "asc");
    expect(second).toContain("c.last_name");
  });

  // Point 4: `status` and `updated` order on the household column directly —
  // an exact match rules out a subquery, which would render as a completely
  // different string (name/primary/spouse render a `(select ...)` fragment).
  it("status orders on the household status column directly, not a subquery", () => {
    const [leading] = orderByText("status", "asc");
    expect(leading).toBe('"crm_households"."status" asc nulls last');
  });

  it("updated orders on the household updated_at column directly, not a subquery", () => {
    const [leading] = orderByText("updated", "desc");
    expect(leading).toBe('"crm_households"."updated_at" desc nulls last');
  });

  // Point 5: the spouse terms must actually select the SPOUSE contact. Every
  // assertion above survives a mutation that points `spouse` at the primary
  // subqueries, because the field names (first_name/last_name) are identical.
  it("spouse's terms select the spouse contact, not the primary", () => {
    const [leading, second] = orderByText("spouse", "asc");
    expect(leading).toContain("c.role = 'spouse'");
    expect(leading).toContain("c.first_name");
    expect(second).toContain("c.role = 'spouse'");
    expect(second).toContain("c.last_name");
  });
});
