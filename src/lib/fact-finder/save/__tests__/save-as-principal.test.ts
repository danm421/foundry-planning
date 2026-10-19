// src/lib/fact-finder/save/__tests__/save-as-principal.test.ts
//
// Live dev database: the save run on a principal, with no Clerk session — as
// the Claude connector runs it. A principal of the client's firm saves; one of
// another firm is refused by the write cores' access check, and nothing is
// written. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// No session at all: every access check must run on the principal the save passes.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null, orgId: null, orgRole: null, actor: null }),
}));

import { createAccountForClient } from "@/lib/clients/accounts-writes";
import type { Principal } from "@/lib/clients/authz";
import { linkedTo, rowOf, stateWith } from "../../placement/__tests__/fixtures";
import { saveChangeSet } from "../save";
import { unwrap } from "../types";
import { endToEnd, importOf, NOW, recordOf, type Reviewed } from "./end-to-end";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient } from "./harness";

const FIRM = "firm_test_ff_save_as_principal";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const { planOf, review } = endToEnd(FIRM);
/** The advisor's own firm, as the connector verifies it. */
const ADVISOR: Principal = { userId: SAVE_ACTOR, orgId: FIRM, orgRole: "org:admin" };

/** The save as a connector call makes it: the principal, no session. */
const saveAs = (r: Reviewed, principal: Principal) =>
  saveChangeSet(
    { scope: r.scope, actorId: SAVE_ACTOR, principal, changeSetVersion: r.changeSet.builtAtVersion, ticks: r.ticks },
    { resolveHoldings: async () => new Map(), now: () => NOW },
  );

/** A client with one IRA (made on the principal too: there is no session), reviewed against a fact finder whose retirement row links to it with a new value. */
async function reviewedIra() {
  const seed = await seedSaveClient(FIRM);
  const ira = unwrap(
    await createAccountForClient({
      clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR, principal: ADVISOR,
      input: { name: "Rollover IRA", category: "retirement", subType: "traditional_ira", value: 300000 },
    }),
  ).resourceId;
  const r = await review(seed, stateWith({ retirement: [rowOf("r1", { currentValue: 412000 }, { link: linkedTo(ira) })] }));
  return { seed, r };
}

d("the save on a principal, with no session (live DB)", () => {
  // Clearing a firm of its households can outlast the default hook timeout on a cold dev branch.
  beforeAll(async () => dropSaveFirm(FIRM), 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it("saves an update to an existing account with a principal and no session", async () => {
    const { seed, r } = await reviewedIra();
    const outcome = await saveAs(r, ADVISOR);
    expect(outcome.ok).toBe(true);
    expect(recordOf(await planOf(seed), "account", "Rollover IRA").values.value).toBe(412000);
  });

  it("refuses the same save for a principal of another firm, and writes nothing", async () => {
    const { seed, r } = await reviewedIra();
    const outcome = await saveAs(r, { ...ADVISOR, orgId: "org_other" });
    expect(outcome).toMatchObject({ ok: false, status: 422, lineId: "r1/account" });
    expect(recordOf(await planOf(seed), "account", "Rollover IRA").values.value).toBe(300000);
    const imp = await importOf(r.scope);
    expect(imp).toMatchObject({ status: "draft", committedAt: null });
    expect(imp.factFinder?.closed).toBeUndefined();
  });
});
