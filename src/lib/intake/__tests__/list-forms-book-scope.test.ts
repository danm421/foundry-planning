// The Data Collection queue lists only forms in the caller's book: a form bound
// to a client by that client's advisor, a form with no client by the advisor
// who sent it. Unit test: the query's WHERE clause is captured and rendered.
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const captured = vi.hoisted(() => ({ where: undefined as unknown }));
vi.mock("@/db", () => {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: (w: unknown) => {
      captured.where = w;
      return chain;
    },
    orderBy: async () => [],
  };
  return { db: { select: () => chain } };
});

import { listFormsForFirm } from "../queries";
import { VISIBLE_ALL } from "@/lib/visibility";

const rendered = () => new PgDialect().sqlToQuery(captured.where as SQL);

describe("listFormsForFirm", () => {
  it("narrows a siloed advisor to their own clients' forms and their own prospect forms", async () => {
    await listFormsForFirm("firm-1", new Set(["adv-a"]));
    const { sql, params } = rendered();
    expect(sql).toContain('"clients"."advisor_id"');
    expect(sql).toContain('"intake_forms"."created_by_user_id"');
    expect(params).toEqual(["firm-1", "adv-a", "adv-a"]);
  });

  it("matches nothing for a caller with an empty book", async () => {
    await listFormsForFirm("firm-2", new Set());
    expect(rendered().sql).toContain("false");
  });

  it("lists the whole firm for a caller who sees every book", async () => {
    await listFormsForFirm("firm-3", VISIBLE_ALL);
    const { sql, params } = rendered();
    expect(sql).not.toContain("advisor_id");
    expect(params).toEqual(["firm-3"]);
  });
});
