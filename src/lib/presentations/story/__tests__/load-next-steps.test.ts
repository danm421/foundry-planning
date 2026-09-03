// Only `@/db` is mocked — the schema, drizzle-orm and
// `buildObservationsPageData` are all real, so the scoping assertion reads the
// SQL this module actually builds and every mapping assertion is about what the
// shared builder really returned. Same pattern as `scenario-label.test.ts`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const m = vi.hoisted(() => ({ where: vi.fn(), rows: [] as unknown[] }));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          m.where(w);
          return { orderBy: async () => m.rows };
        },
      }),
    }),
  },
}));

import { loadStoryNextSteps } from "../load-next-steps";
import type { TokenContext } from "@/lib/plan-text/tokens";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as never);

const CLIENT = "c1a11111-2222-4333-8444-555555555555";

/** Enough of a plan for the token resolver to answer from. Every token is
 *  `safe()`-wrapped, so a field it cannot find resolves to null rather than
 *  throwing — which is what makes this fixture small. */
const TOKENS = {
  clientData: { client: { firstName: "Alan", spouseName: "Teresa" } },
  projection: { years: [] },
  monteCarlo: null,
} as unknown as TokenContext;

const row = (over: Record<string, unknown> = {}) => ({
  section: "next_step",
  topic: "general",
  title: "Send us last year's tax return",
  body: "Whatever you have — we'll chase the rest.",
  status: "open",
  owner: "client",
  priority: null,
  targetDate: "2026-03-01",
  sortOrder: 0,
  ...over,
});

beforeEach(() => {
  m.where.mockReset();
  m.rows = [];
});

describe("loadStoryNextSteps", () => {
  /**
   * The scoping clause. These rows are one client's action items and the story
   * loader is called with a client id off the route's params, so a read without
   * it would hand one household's next steps to another's report.
   */
  it("scopes the read to this client, to next steps, and to the client audience", async () => {
    await loadStoryNextSteps(CLIENT, TOKENS);

    expect(m.where).toHaveBeenCalledTimes(1);
    const { sql, params } = render(m.where.mock.calls[0][0]);
    expect(sql).toContain('"plan_observations"."client_id" =');
    expect(params).toEqual([CLIENT, "next_step", "client"]);
  });

  it("takes the advisor's own one-liner, with the owner and date the page would print", async () => {
    m.rows = [row()];

    // "Client" and the long date are the Observations page's own spellings, not
    // a second set — the two pages can sit a few leaves apart in one PDF.
    expect(await loadStoryNextSteps(CLIENT, TOKENS)).toEqual([
      { text: "Send us last year's tax return", owner: "Client", when: "March 1, 2026" },
    ]);
  });

  it("falls back to the body when the row was written without a title", async () => {
    m.rows = [row({ title: null, body: "Open the joint brokerage account." })];

    const [step] = await loadStoryNextSteps(CLIENT, TOKENS);
    expect(step.text).toBe("Open the joint brokerage account.");
  });

  it("prints the body's words, not its markdown", async () => {
    // The chapter renders each step as one line of plain text, so a body that
    // carried its emphasis through would print the asterisks.
    m.rows = [row({ title: null, body: "Move **$30k** into the new account." })];

    const [step] = await loadStoryNextSteps(CLIENT, TOKENS);
    expect(step.text).toBe("Move $30k into the new account.");
  });

  it("resolves the advisor's merge tokens against the plan", async () => {
    m.rows = [row({ title: null, body: "Call {{client_first_name}} about the rollover." })];

    const [step] = await loadStoryNextSteps(CLIENT, TOKENS);
    expect(step.text).toBe("Call Alan about the rollover.");
  });

  it("leaves the owner and date empty when the advisor filled neither in", async () => {
    m.rows = [row({ owner: null, targetDate: null })];

    // "" rather than null: the layout joins whichever it has, and the chapter's
    // lead paragraph promises a caption only when one of them is set.
    expect(await loadStoryNextSteps(CLIENT, TOKENS)).toEqual([
      { text: "Send us last year's tax return", owner: "", when: "" },
    ]);
  });

  /**
   * The query asks for next steps; this proves nothing else can become one if
   * it ever stopped asking. The mock answers whatever the SQL said, so an
   * observation row arriving here is exactly the state that filter makes
   * unreachable — and the builder's own section check is what drops it then.
   */
  it("drops an observation even if the query hands it one", async () => {
    m.rows = [row({ section: "observation", title: "They're saving 18% of gross" }), row()];

    const steps = await loadStoryNextSteps(CLIENT, TOKENS);
    expect(steps.map((s) => s.text)).toEqual(["Send us last year's tax return"]);
  });

  it("drops a step that has already been done", async () => {
    m.rows = [row({ status: "done" }), row({ title: "Open the joint brokerage account" })];

    const steps = await loadStoryNextSteps(CLIENT, TOKENS);
    expect(steps.map((s) => s.text)).toEqual(["Open the joint brokerage account"]);
  });

  it("drops a row with nothing in it rather than numbering a blank line", async () => {
    m.rows = [row({ title: "  ", body: "" }), row({ title: "Check the beneficiary" })];

    const steps = await loadStoryNextSteps(CLIENT, TOKENS);
    expect(steps.map((s) => s.text)).toEqual(["Check the beneficiary"]);
  });

  it("keeps the advisor's own order", async () => {
    m.rows = [
      row({ title: "First", sortOrder: 0 }),
      row({ title: "Second", sortOrder: 1 }),
      row({ title: "Third", sortOrder: 2 }),
    ];

    const steps = await loadStoryNextSteps(CLIENT, TOKENS);
    expect(steps.map((s) => s.text)).toEqual(["First", "Second", "Third"]);
  });
});
