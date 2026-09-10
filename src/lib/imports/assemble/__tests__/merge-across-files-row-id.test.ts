import { describe, it, expect } from "vitest";
import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";

/**
 * `__rowId` (Task 6) tests. Separate from `merge-across-files.test.ts`
 * because that file exercises merge/collapse BEHAVIOR (which row wins,
 * what warning fires); these exercise the id-stability CONTRACT the row
 * handle depends on (C6) — different axis, same function under test.
 */
describe("mergeAcrossFiles — __rowId", () => {
  // C6 test 1 / C1's whole justification: `mergeAcrossFiles` is documented
  // pure and deterministic, and `committedRowIds` persists across a
  // re-assemble. A random id would orphan every committed row the moment
  // the merge re-runs — this proves it doesn't.
  it("gives identical __rowIds across two merges of the same input", () => {
    const fileResults = {
      f1: er("stmt.pdf", {
        accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 450000, category: "retirement" }],
      }),
    };
    const r1 = mergeAcrossFiles(fileResults);
    const r2 = mergeAcrossFiles(fileResults);
    expect(r1.payload.accounts[0].__rowId).toBeDefined();
    expect(r1.payload.accounts[0].__rowId).toEqual(r2.payload.accounts[0].__rowId);
  });

  // C6 test 2 / R57: derived-from-key ids alone make this pass even without
  // C2's entry-carried id, because both occurrences hash to the same key.
  // The assertion that actually bites is `toBeDefined()` — the collapse
  // rewrite rebuilds the row from `existingEntry.content` (raw extracted
  // content, no `__rowId`), so a stamp-at-push-time-only implementation
  // leaves this `undefined`. Pinning the exact expected id too, per R57.
  it("keeps a defined __rowId, equal to the dedupe-key id, after two files collapse into one row", () => {
    const r = mergeAcrossFiles({
      f1: er("jan.pdf", {
        accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 450000, category: "retirement" }],
      }),
      f2: er("feb.pdf", {
        accounts: [{ name: "401k", custodian: "fidelity", accountNumberLast4: "1234", value: 455000, category: "retirement" }],
      }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    expect(r.payload.accounts[0].__rowId).toBeDefined();
    expect(r.payload.accounts[0].__rowId).toBe("account:fidelity|1234|");
  });

  // C6 test 3: `computeKey` returns null for accounts with no
  // custodian/last4, so two such rows share no dedupe key — the fallback
  // must separate them by position, not collide on name alone.
  it("gives distinct __rowIds to two null-key rows with the same name", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "Brokerage", value: 100, category: "taxable" }] }),
      f2: er("b.pdf", { accounts: [{ name: "Brokerage", value: 100, category: "taxable" }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
    const ids = r.payload.accounts.map((a) => a.__rowId);
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBeDefined();
    expect(ids[0]).not.toEqual(ids[1]);
  });

  it("gives two genuinely different accounts distinct __rowIds", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1111", value: 1, category: "retirement" }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "2222", value: 2, category: "retirement" }] }),
    });
    expect(r.payload.accounts.map((a) => a.__rowId)).toEqual([
      "account:fidelity|1111|",
      "account:fidelity|2222|",
    ]);
  });

  // C3: concatSection sections (dependents, entities, lifePolicies, wills,
  // savings) get stamped too, from `provenance.section` + push index — the
  // only identity that exists on that path.
  it("stamps __rowId on concatSection rows (entities) from section + push index", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { entities: [{ name: "Acme LLC" }] }),
      f2: er("b.pdf", { entities: [{ name: "Other LLC" }] }),
    });
    expect(r.payload.entities.map((e) => e.__rowId)).toEqual(["entities:0", "entities:1"]);
  });

  // Dependents' provenance.section is "family" (not "dependents" — see
  // `provenanceFor("family")` in mergeAcrossFiles), so its ids key off that
  // instead. Pinned here so a future rename of that section string is caught.
  it("stamps __rowId on concatSection rows (dependents) using the 'family' provenance section", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { family: { dependents: [{ firstName: "Jo" }] } }),
    });
    expect(r.payload.dependents.map((d) => d.__rowId)).toEqual(["family:0"]);
  });

  // Round 1 review, Critical 1: a bucket is an ARRAY of entries, not a
  // single one. `computeKey` alone is not injective — two rows can share a
  // key and still fail `isSameEntity`, landing as TWO separate entries in
  // the same bucket. Liabilities key on the bare lowercased name and accept
  // balances within 1% as "the same"; two statements both naming a
  // liability "Mortgage" with balances more than 1% apart (300,000 vs
  // 292,000, ~2.67% apart) are judged different entities and must NOT
  // collapse — but a bare `${label}:${key}` derivation would still mint the
  // identical id for both, silently aliasing two unrelated rows in the flat
  // `committedRowIds` list.
  it("gives distinct __rowIds to two same-key liabilities that fail isSameEntity", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { liabilities: [{ name: "Mortgage", balance: 300000 }] }),
      f2: er("b.pdf", { liabilities: [{ name: "Mortgage", balance: 292000 }] }),
    });
    expect(r.payload.liabilities).toHaveLength(2);
    const ids = r.payload.liabilities.map((l) => l.__rowId);
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBeDefined();
    expect(ids[0]).not.toEqual(ids[1]);
    // Pin the exact shape too, not just "different": first entry under a
    // key is unchanged, later ones fold in the bucket ordinal.
    expect(ids).toEqual(["liability:mortgage", "liability:mortgage#1"]);
  });
});
