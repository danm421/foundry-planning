// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CandidateRow } from "@/lib/entity-extraction/types";

/**
 * Task 2 (Phase 3A). No entity declares `updateSemantics` yet — Tasks 3 and 5
 * do — so the opted-in case has to be staged here. This wraps the REAL
 * `findEntity` and adds the declaration only for the ids a test opts in, so
 * every other test in this file still sees the real map unchanged.
 */
const OPTED_IN_ENTITY_IDS = vi.hoisted(() => new Set<string>());

vi.mock("@/domain/forge/detail-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/forge/detail-fields")>();
  return {
    ...actual,
    findEntity: (id: string) => {
      const entity = actual.findEntity(id);
      if (!entity || !OPTED_IN_ENTITY_IDS.has(id)) return entity;
      return { ...entity, updateSemantics: { method: "PUT" as const } };
    },
  };
});

// Imported AFTER the mock so the component's own `findEntity` is the wrapped one.
import EntityTables from "../entity-tables";

afterEach(() => OPTED_IN_ENTITY_IDS.clear());

function row(entityId: string, rowId: string, values: Record<string, unknown>, extra: Partial<CandidateRow> = {}): CandidateRow {
  return {
    entityId,
    rowId,
    values: Object.entries(values).map(([key, value]) => ({ key, value, snippet: "x", confidence: 0.9 })),
    missingRequired: [],
    rowConfidence: 0.9,
    ...extra,
  };
}

/**
 * Rows the entity's OWN create route would accept. Since I4 (Ruling 36) the
 * table asks `buildWriteRequest` for the final verdict, so a fixture that
 * fills only the map-`required` fields is blocked for a reason no test here is
 * about — and an "is the button enabled?" assertion on such a row would pass
 * or fail for the wrong cause.
 */
const VALID_LIFE = {
  name: "Term Life 20",
  policyType: "term",
  insuredPerson: "client",
  ownerRef: { kind: "joint" },
  faceValue: 500000,
  termIssueYear: 2020,
  termLengthYears: 20,
};
const VALID_DISABILITY = {
  name: "Group LTD",
  insured: "client",
  carrier: "Unum",
  ltdBenefitPeriodAge: 65,
};

const rows = {
  life_insurance_policy: [row("life_insurance_policy", "l1", VALID_LIFE)],
  disability_policy: [row("disability_policy", "d1", VALID_DISABILITY)],
};

const props = { rows, committedRowIds: [], onCommitRows: vi.fn(), onEditCell: vi.fn() };

describe("EntityTables", () => {
  it("renders one table per entity, titled with the entity label", () => {
    render(<EntityTables {...props} />);
    expect(screen.getByRole("table", { name: /life insurance policy/i })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /disability policy/i })).toBeInTheDocument();
  });

  // Real map fixtures, not two rows on the same tab (Task 12 review,
  // Important 3): both original fixtures were `tab: "insurance"`, so the
  // assertion was decided entirely by the label tie-break and passed even
  // with the tab comparator deleted outright. "account" is `tab: "net-worth"`
  // and "transfer" is on `tab: "techniques"`, which `TAB_ORDER` never lists —
  // pinning BOTH contracts: net-worth sorts before insurance, and an unlisted
  // tab sorts LAST rather than first.
  it("orders tables by the Details sidebar — net-worth before insurance, and an unlisted tab last", () => {
    const mixed = {
      account: [row("account", "a1", { name: "Test Account" })],
      life_insurance_policy: rows.life_insurance_policy,
      transfer: [row("transfer", "t1", { name: "Transfer 1" })],
    };
    render(<EntityTables {...props} rows={mixed} />);
    const tables = screen.getAllByRole("table").map((t) => t.getAttribute("aria-label"));
    expect(tables.indexOf("Account")).toBeLessThan(tables.indexOf("Life insurance policy"));
    expect(tables.indexOf("Transfer")).toBe(tables.length - 1);
  });

  it("renders nothing for an entity with no rows", () => {
    render(<EntityTables {...props} rows={{ life_insurance_policy: rows.life_insurance_policy }} />);
    expect(screen.queryByRole("table", { name: /disability/i })).not.toBeInTheDocument();
  });

  it("blocks commit on a row missing a required field and names it", () => {
    const blocked = { life_insurance_policy: [row("life_insurance_policy", "l1", { name: "Term Life 20" }, { missingRequired: ["faceValue"] })] };
    render(<EntityTables {...props} rows={blocked} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(within(target).getByText(/death benefit/i)).toBeInTheDocument();
  });

  it("marks a low-confidence cell for review without pre-selecting discard", () => {
    const shaky = { life_insurance_policy: [row("life_insurance_policy", "l1", VALID_LIFE, { rowConfidence: 0.4 })] };
    render(<EntityTables {...props} rows={shaky} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByTestId("needs-review")).toBeInTheDocument();
    expect(within(target).getByRole("button", { name: /commit/i })).not.toBeDisabled();
  });

  /**
   * Final review C1 / Ruling 34. This row used to render the word "Update"
   * with an ENABLED Commit button, and `buildWriteRequest` has no update leg
   * at all — every non-array entity returns `POST routes.create`. So the one
   * row the table promised to update was the one it DUPLICATED. The update
   * leg is not built here (each entity's update route has its own partial
   * semantics); the honest answer is to refuse and name where to finish.
   */
  it("blocks commit on an exact match and never promises an update", () => {
    const matched = { life_insurance_policy: [row("life_insurance_policy", "l1", VALID_LIFE, { match: { kind: "exact", existingId: "p1" } })] };
    render(<EntityTables {...props} rows={matched} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(within(target).getByText(/already exists — update it on the Details tab/i)).toBeInTheDocument();
    // The action word itself, which is its own text node. A row that still
    // said "Update" would be promising the leg that does not exist.
    expect(within(target).queryByText("Update")).not.toBeInTheDocument();
  });

  /**
   * Final review C2 / Ruling 35. `confidence.ts` stamps `ungrounded` on EVERY
   * snippet-less value, optional ones included; `build-request.ts` refuses the
   * whole write if any value carries any issue. The table blocked on `fuzzy`
   * and `missingRequired` only — so one snippet-less OPTIONAL value rendered
   * unmarked with Commit live, and clicking it threw the writer's refusal
   * under the button on a table with no cell editing to clear it with.
   */
  it("blocks commit on a value carrying an issue and names the field and the reason", () => {
    const flagged = {
      life_insurance_policy: [
        {
          ...row("life_insurance_policy", "l1", VALID_LIFE),
          values: [
            ...row("life_insurance_policy", "l1", VALID_LIFE).values,
            // The exact shape `confidence.test.ts` treats as ordinary: an
            // OPTIONAL value the model gave no snippet for.
            { key: "cashValue", value: 12345, snippet: null, confidence: 0.9, issue: "ungrounded" as const },
          ],
        },
      ],
    };
    render(<EntityTables {...props} rows={flagged} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByRole("button", { name: /commit/i })).toBeDisabled();
    // The on-screen label, not the payload key — "cashValue" means nothing to
    // the person reading it.
    expect(within(target).getByText(/Check Current cash value \(not found in the document\)/i)).toBeInTheDocument();
  });

  /**
   * Final review I6 / Ruling 35, the display half. `toView` copied
   * `value.value` and threw `value.issue` away, so an off-enum
   * "Universal Life" rendered as ordinary text in the Policy type column with
   * nothing marking it — against the spec's own "nothing is silently dropped;
   * a value that cannot be placed is visible WITH ITS REASON attached".
   */
  it("shows a flagged value's reason in the value's own cell rather than dropping it", () => {
    const flagged = {
      life_insurance_policy: [
        {
          ...row("life_insurance_policy", "l1", { name: "Term Life 20" }),
          values: [
            { key: "name", value: "Term Life 20", snippet: "x", confidence: 0.9 },
            { key: "policyType", value: "Universal Life", snippet: "x", confidence: 0.9, issue: "enum" as const },
          ],
        },
      ],
    };
    render(<EntityTables {...props} rows={flagged} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    const marks = within(target).getAllByTestId("value-issue");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent(/not a known option/i);
    // In the CELL, beside the value it belongs to — and the value itself is
    // still shown, never replaced by its reason.
    expect(marks[0].closest("td")).toHaveTextContent("Universal Life");
  });

  // Negative cases (Task 12 review, Important 5): the two positive tests
  // above pass even against a hardcoded `{ needsReview: true, action:
  // "Update" }`. A clean, unmatched row must show NEITHER the review marker
  // NOR "Update" — it reads as a plain new row.
  it("leaves a clean, unmatched row unmarked and reads it as a new record", () => {
    const clean = { life_insurance_policy: rows.life_insurance_policy };
    render(<EntityTables {...props} rows={clean} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).queryByTestId("needs-review")).not.toBeInTheDocument();
    expect(within(target).getByText("Add")).toBeInTheDocument();
  });

  // Critical 1: an unresolved `fuzzy` match (a candidate LIST, no chosen
  // record) must block the commit AND must never read "Update" — there is no
  // picked record to update.
  it("blocks commit on an unresolved fuzzy match and does not promise an update", () => {
    const fuzzy = {
      life_insurance_policy: [
        row(
          "life_insurance_policy",
          "l1",
          VALID_LIFE,
          { match: { kind: "fuzzy", candidates: [{ id: "p1", score: 0.6 }] } },
        ),
      ],
    };
    render(<EntityTables {...props} rows={fuzzy} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(within(target).queryByText(/update/i)).not.toBeInTheDocument();
  });

  /**
   * Final review I4 / Ruling 36, on the surface. Every map-`required` field is
   * filled, nothing is flagged and nothing is matched — and the route still
   * 400s, because a term policy needs a term issue year. The table asks
   * `buildWriteRequest` for the last word rather than keeping a second copy of
   * its rules, so this can never drift from what the commit would actually do.
   */
  it("blocks commit on a row the route's own create schema would refuse", () => {
    const noIssueYear: Record<string, unknown> = { ...VALID_LIFE };
    delete noIssueYear.termIssueYear;
    const incomplete = { life_insurance_policy: [row("life_insurance_policy", "l1", noIssueYear)] };
    render(<EntityTables {...props} rows={incomplete} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(
      within(target).getByText(/Term issue year: Term policies need a term issue year/i),
    ).toBeInTheDocument();
  });

  // Important 2: the brief requires fields past the column cap to be
  // reachable through `entity-table.tsx`'s existing `expand` disclosure —
  // for `life_insurance_policy` that is 14 of 22 fields with no way to see
  // them at all otherwise. "Premium payment years" is the first field past
  // the 8-column cap (5 required + cashValue/costBasis/premiumAmount).
  it("reveals the fields past the column cap through the row disclosure", async () => {
    render(<EntityTables {...props} rows={{ life_insurance_policy: rows.life_insurance_policy }} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(screen.queryByText("Premium payment years")).not.toBeInTheDocument();
    await userEvent.click(within(target).getByRole("button", { name: /show/i }));
    expect(screen.getByText("Premium payment years")).toBeInTheDocument();
  });

  // The other half: an entity with nothing past the cap gets no disclosure
  // button at all — `entity-table.tsx` renders one only when `expand`
  // returns non-null for a row, and `medicare_coverage` (a real map entity)
  // has just 7 askable fields, none past the cap.
  it("gives an entity with nothing past the column cap no disclosure button", () => {
    const noOverflow = { medicare_coverage: [row("medicare_coverage", "m1", { owner: "client" })] };
    render(<EntityTables {...props} rows={noOverflow} />);
    const table = screen.getByRole("table", { name: /medicare/i });
    expect(within(table).queryByRole("button", { name: /show/i })).not.toBeInTheDocument();
  });
});

/**
 * Task 2 (Phase 3A), the surface half. `buildWriteRequest` now has a real
 * update leg, opted into per entity. This table's ONE RULE cuts both ways: it
 * may not say "committable" where the writer would refuse, and it may not say
 * "Add" where the writer would UPDATE.
 *
 * The opt-OUT regression guard is the existing "blocks commit on an exact
 * match and never promises an update" case above, which runs with
 * `OPTED_IN_ENTITY_IDS` empty — an entity that has not declared its
 * partial-update semantics is still blocked, still told to use the Details
 * tab, and still never captioned "Update".
 */
describe("EntityTables — an entity that has opted into updates", () => {
  const matched = {
    life_insurance_policy: [
      row("life_insurance_policy", "l1", VALID_LIFE, { match: { kind: "exact", existingId: "p1" } }),
    ],
  };

  it("lets an exact match through to the writer instead of blocking it", () => {
    OPTED_IN_ENTITY_IDS.add("life_insurance_policy");
    render(<EntityTables {...props} rows={matched} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByRole("button", { name: /commit/i })).not.toBeDisabled();
    expect(
      within(target).queryByText(/already exists — update it on the Details tab/i),
    ).not.toBeInTheDocument();
  });

  it("captions that row 'Update', never 'Add'", () => {
    OPTED_IN_ENTITY_IDS.add("life_insurance_policy");
    render(<EntityTables {...props} rows={matched} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByText("Update")).toBeInTheDocument();
    expect(within(target).queryByText("Add")).not.toBeInTheDocument();
  });

  it("still captions an UNMATCHED row on the same entity 'Add'", () => {
    // The other half: opting an entity in must not relabel every row. Without
    // this, hardcoding "Update" would pass the case above.
    OPTED_IN_ENTITY_IDS.add("life_insurance_policy");
    render(<EntityTables {...props} rows={{ life_insurance_policy: rows.life_insurance_policy }} />);
    const target = screen.getByRole("row", { name: /Term Life 20/ });
    expect(within(target).getByText("Add")).toBeInTheDocument();
    expect(within(target).queryByText("Update")).not.toBeInTheDocument();
  });
});
