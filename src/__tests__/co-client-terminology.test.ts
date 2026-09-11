/**
 * "Spouse" must not appear in anything an advisor or client can read.
 *
 * The second person in a household is a Co-client. The word survives only as a
 * tax or legal term of art (TERMS_OF_ART) or in a file that is factually about
 * the marital relationship, machine-facing, or a scanner artifact — and then
 * only with its reason written next to it (PERMANENT_ALLOWLIST).
 *
 * The sweep is finished, so the PENDING ratchet that carried it is gone: this is
 * now a plain gate. A new "Spouse" string fails the build unless it earns one of
 * the two exits above, in a diff a reviewer can see.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/** Tax and legal language. Changing these makes the output wrong, not just differently worded.
 *  `non[-\s]spouse,?\s*non[-\s]charity` protects the exact IRS-defined inherited-IRA beneficiary
 *  phrase in tax-rates-form.tsx's IRD tax rate help text (a surviving-spouse beneficiary may roll
 *  over into their own IRA and use the Uniform Lifetime Table; a non-spouse beneficiary may not —
 *  the same doctrinal boundary "Spousal rollover" protects, on the other side of it). Scoped to
 *  the compound "non-spouse, non-charity" phrase, not bare "non-spouse", so it doesn't swallow
 *  unrelated "non-spouse recipients"-style copy elsewhere that isn't this IRS term.
 *  `legal\s+spouse` protects statutory copy that paraphrases a provision whose reach is the
 *  taxpayer's LEGAL spouse and no one else — IRC §162(l)'s self-employed health insurance
 *  deduction (tax-analysis/findings/business.ts). An unmarried co-client does not qualify, so
 *  saying "co-client" there would ship factually wrong tax guidance. Scoped to the qualified
 *  phrase so a bare "spouse" in ordinary advisor copy still trips the scanner.
 *
 *  Global on purpose: `violations()` only ever `.replace()`s with it (never `.test()`s, which
 *  would be stateful on a /g/ regex), because it has to strip EVERY term of art from a hit
 *  before judging the remainder. */
const TERMS_OF_ART =
  /(surviving\s+spouse|spousal|married\s+filing|qualifying\s+widow|marital\s+deduction|ex[-\s]spouse|former\s+spouse|deceased\s+spouse|legal\s+spouse|non[-\s]spouse,?\s*non[-\s]charity)/gi;

/** Files that are legitimately about the marital relationship, forever. */
const PERMANENT_ALLOWLIST = new Set<string>([
  // The CRM records a real relationship (Spouse / Partner / Child), not a planning role.
  "src/lib/crm/relationship-labels.ts",
  "src/components/crm-contact-form.tsx",
  // Teaches the extractor to recognise OTHER software's wording in imported documents.
  "src/lib/extraction/prompts/savings.ts",
  // This test states the word in order to ban it.
  "src/__tests__/co-client-terminology.test.ts",
  // Same crm_household_contacts `role` field (primary/spouse/dependent/other) that
  // crm-contact-form.tsx already treats as a real CRM relationship label, not a
  // planning role (see that file's entry above) — this is its read-only badge.
  "src/app/(app)/crm/households/[id]/tabs/contacts-tab.tsx",
  "src/app/(app)/crm/households/[id]/tabs/__tests__/contacts-tab.test.tsx",
  // Only hit is `currentSalaryByPerson={{ client: salaryFor("client"), spouse: salaryFor("spouse") }}` —
  // an object key / engine person-id argument (Bucket C), not display copy. The
  // naive quote-pairing scanner matches text spanning the two separate string
  // literals on that line, not a real "Spouse" string.
  "src/app/(app)/clients/[id]/details/insurance/insurance-content.tsx",
  // Only hit is the template literal `${spouse.firstName} ${spouse.lastName}` —
  // `spouse` there is a local variable holding a CRM contact record; the scanner
  // matches the variable name inside the backticks, not literal display text.
  "src/app/(app)/clients/[id]/portal/page.tsx",

  // ── Task 6: estate spine cards use a `--color-spouse` Tailwind design token
  // (src/app/globals.css) for the household's second-person color swatch —
  // `border-spouse/30`, `bg-spouse/15`, etc. The token name is a Bucket C
  // design-system identifier, never rendered as text a person reads.
  "src/app/(app)/clients/[id]/estate-planning/spine/combined-block.tsx",
  "src/app/(app)/clients/[id]/estate-planning/spine/pair-row.tsx",

  // ── Task 6 fix round 2 (2026-09-10): round 1's F3(a) named 5 specific
  // fallback-label sites but missed 4 more in the identical class (same
  // `people.spouseName || <literal>` pattern, same files). Fixed here, and
  // `commit-preview-dialog.tsx`, `divorce-workbench.tsx`, and
  // `divisible-card.tsx` all dropped to zero remaining "Spouse" hits as a
  // result — all three REMOVED from this list entirely.
  //
  // Five files that were here for `it()`-title prose alone were MOVED to the
  // PENDING ratchet instead of staying permanently allowlisted, so that one
  // consistent policy could be decided for them and their ~150 unowned
  // test-file siblings rather than a one-off exemption made inside a fix round.
  // Task 11 decided it: the scanner no longer reads test files at all (see
  // TEST_FILE below), and PENDING is gone. Those five need no entry here.
  //
  // What's left here is only what's actually settled:
  "src/lib/divorce/__tests__/commit-divorce-plan.test.ts", // genuine ex-spouse/former-spouse hits (4), plus it() titles
  "src/lib/divorce/commit-divorce-plan.ts", // genuine ex-spouse/former-spouse hits (12), plus an unreachable "Spouse contact is incomplete" error (F3(b): never sent to the client — see task-6-report.md)
  // Product decision 2: both files below describe the CRM household contact
  // whose `role` column is literally "spouse" (crmHouseholdContacts.role —
  // commit-preview.ts:236, divorce-plans.ts:89) — a factual CRM relationship
  // field, not a planning-role label. Renaming the message text would make it
  // describe a role the contact record doesn't actually have.
  "src/lib/divorce/commit-preview.ts", // label: "The spouse contact is missing a name or date of birth" (:416)
  "src/lib/divorce/divorce-plans.ts", // error message: "Household has no spouse contact" (:110)
  // Product decision 3: the legal, in-divorce usage — "the departing spouse"
  // describes the real person going through this divorce, not the ordinary
  // co-client sense the rest of the app uses "spouse" for.
  "src/components/divorce/settings-rail.tsx", // FieldTooltip help text: "Where the departing spouse's new household files..." (:171)

  // ── Task 8 (2026-09-10): scanner artifacts and machine-facing diagnostics.
  // None of these files has a person-visible "Spouse" — the scanner's naive
  // quote-pairing and its blindness to `${}` interpolation both produce hits
  // that are not real display copy. Each reason below names the file's only
  // actual hit(s), same standard as the entries above.
  "src/lib/tax-reconciliation/rules/wages.ts", // No display copy anywhere in the file says "Spouse" — grepped case-insensitively and confirmed. Both ratchet hits are scanner artifacts: `${spouse ? "..." : ""}` (:90) matches the bare `spouse` BOOLEAN variable name inside the interpolation, and the `ownerChoices: spouse ? ["client", "spouse"]` line (:138) is a mismatched quote-pairing span (the naive scanner pairs the closing quote of an unrelated backtick-embedded string with the opening quote of `"client"`, spanning across the bare `spouse` identifier in between) — the same class already documented above for insurance-content.tsx and portal/page.tsx.
  "src/components/cashflow/medicare/medicare-year-table.tsx", // Only hit is `` ` / ${y.ages.spouse}` `` (:89) — `y.ages.spouse` is a property access on a numeric ages object (an age, e.g. 63), never the word "Spouse"; the scanner matches the bare property name inside the template literal, not display text. Same class as `insurance-content.tsx`'s already-documented `spouse: salaryFor("spouse")` entry above.
  "src/engine/life-insurance-expiry.ts", // Only hit is a thrown Error's message, `computeTermEndYear: missing spouse dob/retirementAge for ${insured}-insured policy` (:23) — a developer-facing exception, never rendered to an advisor or client.
  "src/engine/what-if/life-insurance-need.ts", // Two hits, both machine-facing: a JSDoc code span documenting the `deceased === "spouse"` comparison (:79), and a thrown Error's message, `buildLifeInsuranceWhatIfData: deceased='spouse' requires spouseDob` (:333) — a developer diagnostic, not display copy.
  "src/lib/life-insurance/need-over-time.ts", // Only hit is a JSDoc code span documenting the same `deceased === "spouse"` comparison the engine throws on (:42) — internal type documentation, not display copy.
  "src/lib/medicare/dbMapper.ts", // Only hit is a thrown Error validating an unexpected DB row value, `medicare_coverage row has unexpected owner "${row.owner}" — expected "client" or "spouse"` (:13) — a developer diagnostic on a malformed row, never shown to a user.
  "src/lib/risk/existing-scores.ts", // Only hit is a JSDoc "KNOWN LIMITATION" comment naming the `subject === "spouse"` branch (:26) — internal documentation of a scoring edge case, not display copy.
  "src/lib/household-map/social-security.ts", // Only hit is a JSDoc comment, "The owner's DOB for an SS row — the SPOUSE's for a spouse-owned benefit" (:20), documenting `ownerDob`'s internal side-selection logic. The file's actual user-facing labels ("no benefit", "at 67", etc.) never mention spouse.

  // ── Task 9 (2026-09-10): scanner artifacts (numeric-age/property-name false
  // positives) and machine-facing JSDoc enum documentation. Each reason names
  // the file's only actual hit(s), same standard as the Task 8 block above.
  "src/components/balance-sheet-report/year-picker.tsx", // Only hit is `` `${a.client} & ${a.spouse}` `` (:26) — `a.spouse` is a numeric age property access (e.g. 65), never the word "Spouse" rendered; same class as `medicare-year-table.tsx` above.
  "src/components/cashflow/projection-ages.ts", // Only hit is `` `${client} / ${spouse}` `` (:24) — `spouse` is a local const already resolved to a dash or a numeric-age string (:23), never the literal word "Spouse".
  "src/components/client-identity-menu.tsx", // Only hits are `spouse.firstName`/`spouseLast` (:57-60) — `spouse` is a local variable holding a real PersonInfo record; the interpolation renders the person's actual name, never the word "Spouse". The component has no other display copy naming the role at all — the household title and age line always use real names.
  "src/components/monte-carlo/yearly-breakdown.tsx", // Only hit is `` `${y.age.client} / ${y.age.spouse}` `` (:38) — `y.age.spouse` is a numeric age property access, same class as year-picker.tsx above.
  "src/components/income-expenses/__tests__/row.test.tsx", // Only hit is a comment documenting the `InlineOwnerCell` owner enum, `` `"client" | "spouse" | "joint"` `` (:8) — machine-facing type documentation, not display copy.
  "src/components/income-expenses-view.tsx", // The one real display hit — the Medicare-eligibility owner `<option value="spouse">Spouse</option>` (:1666, pre-edit) — was renamed to `{CO_CLIENT_LABEL}` in this task. The only hit left is a JSDoc comment documenting the income `owner` enum, `` `client | spouse | joint` `` (:1835) — machine-facing type documentation. This file is large and actively edited; a future user-visible "Spouse" string elsewhere in it would not be caught by the ratchet, but the residual hit is genuinely enum documentation, not a scanner artifact worth leaving in PENDING forever.
  "src/components/tax-ledger/tax-ledger-year-picker.tsx", // The real display hit — the age-label fallback `spouseName?.trim() || "Spouse"` (:53, pre-edit) — was renamed to `CO_CLIENT_LABEL` in this task. The residual hit is a scanner artifact: the same backtick template literal also references the `spouseName` parameter and `ages.spouse` property by name, so the naive scanner still matches the line even though it no longer renders the word "Spouse".
  "src/lib/solver/cashflow-year-detail.ts", // Only hit is `` `Age ${year.ages.client} / ${year.ages.spouse}` `` (:114) — `year.ages.spouse` is a numeric age property access, same class as the two age-label files above.
  "src/lib/tax/state-inheritance/types.ts", // Only hit is a JSDoc comment describing PA's actual statutory Class A definition, `"PA Class A is \"spouse + minor child only\""` (:24) — a real, accurate tax-law description (analogous to "Married filing jointly"), not app terminology, and not display copy (this file has no runtime logic, only type declarations). The `"spouse-role"` classSource literal (:53) and the `"spouse"` union member (:93) are single-word Bucket C enum references the scanner already excludes.

  // ── Task 10 (2026-09-10): import, CRM, Forge, engine and plan-text sweep.
  // Each entry names its file's residual hit(s) with line numbers, plus size
  // and 90-day commit count so a reviewer can judge the allowlist call.
  "src/engine/death-event/first-death.ts", // 870 lines, 7 commits/90d. Only hit is a code comment, `` `all_assets → spouse` `` (:352), documenting the internal residuary-mutation mapping ("all_assets" residuary kind → owner "spouse") — machine-facing, not display copy. The file emits zero `recipientLabel` strings (grepped) — it has no display-string surface at all.
  "src/engine/death-event/section-2035-lookback.ts", // 135 lines, 1 commit/90d. Only hit is a JSDoc code span, `` `"client" | "spouse"` `` (:63), documenting the `GiftEvent.grantor` type union — machine-facing type documentation, no display logic in the file.
  "src/components/crm-import-preview.tsx", // 248 lines, 4 commits/90d. The one real display hit — the CSV-import preview table's "Spouse" column header (:97, invisible to the scanner pre-edit because the JSX text sat on its own line between `>` and `<` — blind spot (a)) — was renamed to "Co-client" in this task. The residual hit is a scanner artifact: `` `${row.spouse.firstName} ${row.spouse.lastName}` `` (:130) is a property access rendering the imported contact's real name, never the literal word "Spouse".
  "src/lib/crm/import/columns.ts", // 158 lines, 2 commits/90d. The real display hit — `FIELD_LABELS` (:60-68), rendered verbatim in the CRM import column-mapping picker (`crm-import-mapping.tsx`, `crm-import-fixes.tsx`) — was renamed to "Co-client first/last/email/date of birth" in this task. The 11 residual hits are the lowercase `ALIASES` synonym lexicon ("spouse first", "spouse last name", etc., :97-100) that Product's own rule for this file requires to STAY: an advisor's existing "Spouse"-headed spreadsheet must keep mapping. Same class as `src/lib/extraction/prompts/savings.ts` above. New "co client ..." synonyms were added alongside, not in place of, the old ones.
  "src/lib/extraction/identify-household.ts", // 133 lines, 2 commits/90d. Only hit is the JSON extraction-schema prompt string sent to the model, `` '{"isHouseholdDoc": ..., "spouse"?: {...}, ...}' `` (:41) — an API/prompt schema key (Bucket C, same protection as the extraction JSON schema generally), not display copy. Framework-free extraction-pipeline file with no UI.
  "src/lib/extraction/__tests__/classify.test.ts", // 117 lines, 2 commits/90d. Both hits are fixture TEXT simulating a raw SOURCE DOCUMENT's own wording fed to `classifyDocument` ("Spouse Jane, date of birth 1970-01-01." at :77; "Spouse filing jointly" in a simulated Form 1040 excerpt at :103) — content from outside Foundry that a real fact-finder or tax return will say regardless of our vocabulary, the same reasoning that keeps `extraction/prompts/savings.ts` on this list.
  "src/lib/extraction/__tests__/will-prompt.test.ts", // 74 lines, 0 commits/90d. Only hit is a schema-fixture value, `recipientNameHint: "spouse Jane Doe"` (:37) — simulates what an AI extractor would echo back from a will's own wording, not display copy; the file's own `.toContain("spouse")` assertion (:21) is the bare Bucket C enum word already excluded by the scanner.
  "src/lib/imports/merge.ts", // 141 lines, 2 commits/90d. The real display hit — `` `Spouse conflict between files: ...` `` (:126, a warning surfaced during multi-file import merge) — was renamed to "Co-client conflict between files: ..." in this task. The 2 residual hits, `` `${family.spouse.firstName} ...}` `` and `` `${payload.spouse.firstName} ...}` `` (:122, :123), are property accesses rendering a real name, never the literal word.
  "src/lib/imports/commit/accounts.ts", // 368 lines, 7 commits/90d. Only hit is a JSDoc comment, `` `owner: 'client'|'spouse'|'joint'` `` (:111), documenting the extracted owner enum — machine-facing. Verified the file's other advisor-facing warnings (529-beneficiary, holdings-guardrail notes) never mention spouse.
  "src/lib/imports/commit/family-resolver.ts", // 141 lines, 3 commits/90d. Both hits are JSDoc comments documenting the same `client|spouse|joint` owner enum (:9-24, :45-46) — pure backend account/liability-owner resolution, no display strings anywhere in the file.
  "src/lib/imports/owner-match.ts", // 180 lines, 4 commits/90d. Only hit is a comment, `` `coarse: "spouse"` `` (:79), documenting the `OwnerResolutionSource` degrade case — machine-facing; the file has no `warnings`/`message` construction at all (grepped).
  "src/lib/imports/planner/__tests__/fixtures/manifest.ts", // 89 lines, 1 commit/90d. The `label` fields are "Human label[s] for the [`eval:planner`] eval output" (developer CLI tooling, never advisor/client-visible); the 2 `", spouse: "` hits are scanner quote-pairing artifacts spanning `ssBasisByOwner: { client: "...", spouse: "..." }` object literals, same class as `wages.ts` above.
  "src/lib/imports/planner/__tests__/golden-assertions.test.ts", // 273 lines, 1 commit/90d. The 2 real hits — `d(60, "Spouse retires at 60 per the narrative.")` and `d(60, "Spouse retires early.")` (:178, :186, unasserted test fixtures) — were renamed to "Co-client retires..." in this task. The 4 residual hits are a JSDoc union-type comment (`` `Record<"client"|"spouse", string>` ``) and 3 more `", spouse: "` quote-pairing artifacts on the same `ssBasisByOwner`/`ssRow` object-literal shape as `manifest.ts` above.

  // ── Task 11 (2026-09-11): every source file left in PENDING once the ratchet
  // stopped scanning tests. Each hit below was read in context; each is either
  // machine-facing or a scanner artifact, EXCEPT thresholds.ts, whose residual
  // hit is a genuine statutory term. The three files here that also had a real
  // display hit had it FIXED in this task, not allowlisted — the reason says so.
  "src/db/schema.ts", // Only hit is a column comment on `crm_household_contacts.role`, `` `role = 'spouse'` `` (:788) — the literal DB enum value. Bucket C: renaming the token would need a migration and would break every query that filters on it.
  "src/engine/contribution-limits.ts", // Only hit is `"), spouse: basisFor("` (:133) — a naive quote-pairing artifact spanning the two separate string literals of `{ client: basisFor("client"), spouse: basisFor("spouse") }`, not a real "spouse" string. Same class as insurance-content.tsx above. Engine file: framework-free, so it could not import owner-labels.ts even if it did render copy — and it renders none.
  "src/engine/family-cashflow.ts", // Only hit is a JSDoc code span documenting a type union, `` `deceased: "client" | "spouse"` `` (:106) — machine-facing enum documentation, same class as death-event/section-2035-lookback.ts above.
  "src/engine/projection.ts", // Two hits, both code comments explaining engine branching — `'t ground the other spouse'` (:6430, the tail of a "doesn't ground the other spouse" sentence the apostrophe splits) and `"a spouse exists to die second"` (:9190). Developer-facing reasoning in a 9k-line framework-free engine file that emits no display copy.
  "src/engine/trust-tax/route-dni.ts", // Only hit is a JSDoc code span documenting the beneficiary-key union, `` ("client" | "spouse") `` (:12) — machine-facing enum documentation, no display strings in the file.
  "src/lib/inline-edit/scenario-fields.ts", // Only hit is the file-header comment "this person has no spouse LE on record" (:11), explaining why a life-expectancy field can be absent. A developer note; the file's own user-facing labels come from the field registry, not from here.
  "src/lib/projection/resolve-entity.ts", // Only hit is a `console.warn` diagnostic, `[resolveExpenseFromRaw] ignoring endsAtMedicareEligibilityOwner="joint" — column is per-person; expected "client" or "spouse"` (:426) — a developer console message naming the two legal enum values, never rendered.
  "src/lib/tax/thresholds.ts", // The real display hit — `iraDeductCovered`'s label "IRA Contribution Deductibility - Covered Spouse" (:77) — was wrong on the facts as well as the vocabulary (it is the ACTIVE-PARTICIPANT phase-out of IRC §219(g)(5), applies to the taxpayer, and fires for single filers) and was renamed to "Covered by Workplace Plan" in this task. The residual hit is :78, `iraDeductSpousal`'s "Non-covered Spouse" — genuine IRC §219(g)(7), the spousal-IRA rule, which requires a MARRIED couple filing jointly. Renaming it would misstate the law. THRESHOLD_ITEMS is a fixed 11-row table mirroring eMoney's report, not a growing copy catalogue, so a file entry is safe here in a way it would not be for tax-analysis/findings/*.
  "src/components/portal/household-contact-dialog.tsx", // The real display hit — `ROLE_LABEL.spouse = "Spouse"` (:12), rendered as a chip on the CLIENT PORTAL by household-contact-cards.tsx:105 — was renamed to "Co-client" in this task. The residual hit is a JSDoc code span, `` `{ primary }` or `{ spouse }` `` (:45), documenting the PUT body's role key — the same DB enum as schema.ts above.
  // ── Task 11 fix round (2026-09-11): `src/components/forge/forge-panel.tsx`
  // used to sit here. A 1,571-line, 49-commits-in-90-days chat UI is far too
  // much surface to exempt forever for one machine key, and with PENDING gone
  // there is no reversible middle ground — so the key MOVED instead. The
  // "[Attached fact finder]" block now lives in the 59-line domain module
  // below, next to the `global-system-prompt.ts` text that tells the model to
  // expect it, and forge-panel.tsx scans clean with no entry at all.
  "src/domain/forge/fact-finder-turn.ts", // 59 lines, new in this fix round. Only hit is the fact-finder context block's key line, `` `spouse: ${id.spouse.firstName} ...` `` (:50) — a lowercase machine key, never read by a person: all three callers pass `skipUserBubble: true` and use-forge-stream.ts:372 suppresses the bubble, so the block reaches the model and nothing else. It mirrors `FactFinderIdentifyResponse.spouse` and the `spouseContact` / `spouseDob` arg vocabulary the model must emit into `ingest_fact_finder` — the same tool-schema vocabulary `src/domain/forge/tools/` is already allowlisted by prefix for. Renaming the key while the schema keeps `spouse` would add a mapping the model has to bridge, for no user-visible gain. Deliberately NOT filed under `src/domain/forge/tools/`: that prefix is for LangChain tool definitions registered in `tools/index.ts`, and putting a message builder there to inherit a blanket prefix exemption would re-create exactly the over-broad exemption this entry replaces.
  // ── Merge with origin/main (2026-09-11): Statement Chat landed after this
  // branch was cut. Its two real display hits — `ROLE_LABELS.spouse` in
  // `owner-cell.tsx` and the owner dropdown's `label: "Spouse"` in
  // `owner-cell-edit.tsx` — were renamed to `CO_CLIENT_LABEL` at merge time,
  // not allowlisted. These two are the machine-facing remainder.
  "src/lib/statement-chat/tools.ts", // Only hit is `fieldDomainDescription`'s `` `one of "client", "spouse", "joint"` `` (:117) — a tool-call validation message returned to the MODEL, enumerating the literal enum values it must emit for `ExtractedAccount.owner`. Its sibling cases return raw enum keys the same way (`Object.keys(ACCOUNT_CATEGORY_SET).join(", ")`), which is what marks this as schema vocabulary rather than advisor prose. Same class as `src/domain/forge/tools/` (allowlisted by prefix) and `fact-finder-turn.ts` above: renaming the word while the schema keeps `spouse` would add a mapping the model has to bridge, for no user-visible gain.
  "src/lib/imports/assemble/merge-across-files.ts", // The real display hit — `mergeFamilyMember(..., "Co-client", ...)` (:906) — was already renamed by Task 10 and auto-merged cleanly. The residual hits are all machine-facing: a JSDoc block documenting the `client | spouse | joint` enum the extractor guesses and the fixture ordering that proved it unstable (:89-93, :804), plus a scanner quote-pairing artifact spanning the worked example `B(client, no hint), C(spouse, "Julia")` in a comment (:438). Same class as `imports/commit/accounts.ts` and `imports/owner-match.ts` above.
]);

/** Directory prefixes that are also allowlisted (Bucket C: machine-facing enum documentation). */
const ALLOWLIST_PREFIXES = [
  "src/lib/extraction/prompts/",
  "src/domain/forge/tools/",
];

/** A quoted string literal or a JSX text node — i.e. something a person reads.
 *  Matches case-insensitively.
 */
const DISPLAY = /("[^"\n]*\bspouse\b[^"\n]*")|('[^'\n]*\bspouse\b[^'\n]*')|(>[^<>{}\n]*\bspouse\b[^<>{}\n]*<)|(`[^`\n]*\bspouse\b[^`\n]*`)/gi;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/**
 * Test files are out of scope: nobody READS one. This rule is what emptied the
 * 166-entry PENDING ratchet — 154 of those entries were test files whose only
 * hits are fixture DATA names ("Spouse Cash", "Spouse SS", a fixture person
 * called "Spouse") or `it()` titles naming the DB's literal `spouse` enum. And
 * `lib/__tests__/owner-labels.test.ts` states the word in order to BAN it,
 * exactly like this file does.
 *
 * Nothing is lost by skipping them. Display copy lives in source, so a new
 * "Spouse" string trips its SOURCE file; a test can only assert a string the
 * source already exposes, which means the source hit fires first.
 *
 * It has to be a regex, not an `ALLOWLIST_PREFIXES` entry: `startsWith` cannot
 * express `*.test.ts`, and `src/lib/clients/get-client-with-contacts.test.ts`
 * sits outside any `__tests__` directory.
 */
const TEST_FILE = /(__tests__|\.test\.tsx?$)/;

function isAllowlisted(f: string): boolean {
  if (TEST_FILE.test(f)) return true;
  if (PERMANENT_ALLOWLIST.has(f)) return true;
  if (ALLOWLIST_PREFIXES.some((prefix) => f.startsWith(prefix))) return true;
  return false;
}

function violations(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(DISPLAY)]
    .filter((m) => {
      const hit = m[0];

      // Exclude the TERMS_OF_ART occurrences and re-test what is LEFT. Testing
      // the whole hit instead (what this did until Task 11) let one term of art
      // anywhere in a string suppress every other "Spouse" in that same string —
      // e.g. medicare/detectors/survivor-tier-shock.ts said "When the first
      // spouse passes ... jumping the surviving spouse to tier N", and the
      // protected "surviving spouse" hid the unprotected "the first spouse"
      // sitting two clauses away. Strip, then look again.
      if (!/\bspouse\b/i.test(hit.replace(TERMS_OF_ART, " "))) return false;

      // Extract the content without delimiters
      const content = hit.slice(1, -1);

      // Exclude if entire string is exactly the bare enum word "spouse" (lowercase only)
      if (content === "spouse") return false;

      // For lowercase "spouse", apply additional exclusions (c) and (d-new).
      // Only apply these rules if the hit contains lowercase "spouse" AND does not contain capitalized "Spouse".
      const hasLowercaseSpouse = /\bspouse\b/.test(hit);
      const hasCapitalizedSpouse = /\bSpouse\b/.test(hit);

      if (hasLowercaseSpouse && !hasCapitalizedSpouse) {
        // c. No space at all in the content (ids, slugs, CSS tokens like border-spouse/30)
        if (!content.includes(" ")) return false;

        // d-new. Match is directly adjacent to hyphen or underscore (fm-spouse, spouse_retirement, etc.)
        const charBefore = text[m.index - 1];
        const charAfter = text[m.index + hit.length];
        if (charBefore === "-" || charBefore === "_" || charAfter === "-" || charAfter === "_") {
          return false;
        }
      }

      return true;
    })
    .map((m) => m[0]);
}

describe("co-client terminology", () => {
  const files = walk(SRC)
    .map((f) => relative(process.cwd(), f))
    .filter((f) => !isAllowlisted(f));

  it("shows no file saying Spouse", () => {
    const offenders = files.filter((f) => violations(f).length > 0);
    expect(
      offenders.map((f) => `${f}: ${violations(f).join(" | ")}`),
      "New visible 'Spouse' copy. Use personLabel()/CO_CLIENT_LABEL from src/lib/owner-labels.ts.",
    ).toEqual([]);
  });
});
