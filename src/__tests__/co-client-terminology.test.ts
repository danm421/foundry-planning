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
 *
 * ── What the scanner reads (2026-09-23)
 *
 * `displayText()` asks the TypeScript parser for the nodes that actually carry
 * text — string literals, the literal spans of a template, and JSX text — and
 * scans only those. It replaced a regex that pattern-matched raw source, which
 * could not tell display copy from the code and comments around it:
 *
 *   - a COMMENT explaining why a string says "co-client" tripped the gate that
 *     the string itself passed;
 *   - `` `${spouse.firstName}` `` tripped it on a variable NAME, while what it
 *     renders is a real person's name;
 *   - `{ client: f("client"), spouse: f("spouse") }` tripped it on a span that
 *     pairs the closing quote of one literal with the opening quote of the
 *     next — text that exists in no string at all.
 *
 * Those three classes were the stated reason for 32 of the 57 entries in
 * PERMANENT_ALLOWLIST. An entry there costs the WHOLE FILE, so removing them
 * puts 32 files back under the gate — `projection.ts` (9k lines) and
 * `income-expenses-view.tsx` (edited constantly), whose entry said in so many
 * words that a new visible "Spouse" in it "would not be caught". Narrowing what
 * the scanner LOOKS AT is what let the gate cover more.
 *
 * It also reads two things the regex could not. A string or a JSX text node
 * that spans a NEWLINE was invisible to it (every branch was `[^\n]*`), which
 * is how a `<th>` whose text sat on its own line between `>` and `<` shipped
 * saying "Spouse" — see the crm-import-preview.tsx history. The parser does not
 * care where the line breaks fall.
 *
 * ── The Details field map
 *
 * `src/domain/forge/detail-fields/` is allowlisted by prefix for the SOURCE scan
 * and gated STRUCTURALLY instead, by the second test below. Its `notes`,
 * `documentHints`, `aliases` and `surface` are read by the extraction model, not
 * by a person (`prompt-builder.ts` feeds them to it; no UI consumes `surface` at
 * all) — the same class as `src/lib/extraction/prompts/` above it. But its
 * `label` IS rendered, so a blanket file exemption would have blinded the gate
 * across 6,736 lines.
 *
 * So the second test reads the real exported registry and checks the two
 * properties that reach a screen: `entity.label` (an `<h3>` and an aria-label,
 * entity-tables.tsx:113,115) and `field.label` (a column header and a `<dt>`,
 * map-columns.ts:126,156). It is fail-CLOSED — MODEL_FACING names the keys it
 * skips, so a NEW prose property added to the registry is checked by default
 * rather than silently ungated. That is the seam a per-property exemption would
 * otherwise open, and it is the same posture `types.ts` takes for `scopePath`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { DETAIL_ENTITIES } from "@/domain/forge/detail-fields";

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

/** Files that are legitimately about the marital relationship, forever.
 *
 *  Cut from 57 entries to 26 on 2026-09-23, and one added. Every entry removed
 *  was here for a hit that only ever existed in the raw source text — a comment,
 *  a `${}` hole matched on a variable NAME, or a span invented between two
 *  adjacent literals — so the file scans clean on its own and needs no
 *  exemption. Nothing was removed by re-judging a hit; only by the hit ceasing
 *  to exist, verified by re-running the scanner over each candidate.
 *
 *  Each removal is a file put BACK under the gate, which is the point: an entry
 *  here costs the WHOLE FILE, and `income-expenses-view.tsx`'s said so outright
 *  ("a future user-visible 'Spouse' string elsewhere in it would not be
 *  caught"). The one addition, `crm/sort-order.ts`, is the opposite trade: the
 *  scanner can now read a string that spans a newline, and found something the
 *  regex had never been able to see.
 *
 *  Six entries below are already dead for a different reason — `TEST_FILE`
 *  excludes them before this set is consulted. That redundancy predates this
 *  change, so it is left alone rather than swept in with it. */
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
  // None of these files has a person-visible "Spouse". What is left after the
  // 2026-09-23 prune is one naive quote-pairing span and three thrown-Error
  // messages whose "spouse" sits in the LITERAL part of a template, not in a
  // `${}` hole — so `stripNonDisplay` cannot reach them and should not: the
  // scanner is right that the word is there, and only a human can say that an
  // exception message is not display copy. Each reason names the actual hit.
  "src/engine/life-insurance-expiry.ts", // Only hit is a thrown Error's message, `computeTermEndYear: missing spouse dob/retirementAge for ${insured}-insured policy` (:23) — a developer-facing exception, never rendered to an advisor or client.
  "src/engine/what-if/life-insurance-need.ts", // Two hits, both machine-facing: a JSDoc code span documenting the `deceased === "spouse"` comparison (:79), and a thrown Error's message, `buildLifeInsuranceWhatIfData: deceased='spouse' requires spouseDob` (:333) — a developer diagnostic, not display copy.
  "src/lib/medicare/dbMapper.ts", // Only hit is a thrown Error validating an unexpected DB row value, `medicare_coverage row has unexpected owner "${row.owner}" — expected "client" or "spouse"` (:13) — a developer diagnostic on a malformed row, never shown to a user.

  // ── Task 10 (2026-09-10): import, CRM, Forge, engine and plan-text sweep.
  // Each entry names its file's residual hit(s) with line numbers, plus size
  // and 90-day commit count so a reviewer can judge the allowlist call.
  "src/lib/crm/import/columns.ts", // 158 lines, 2 commits/90d. The real display hit — `FIELD_LABELS` (:60-68), rendered verbatim in the CRM import column-mapping picker (`crm-import-mapping.tsx`, `crm-import-fixes.tsx`) — was renamed to "Co-client first/last/email/date of birth" in this task. The 11 residual hits are the lowercase `ALIASES` synonym lexicon ("spouse first", "spouse last name", etc., :97-100) that Product's own rule for this file requires to STAY: an advisor's existing "Spouse"-headed spreadsheet must keep mapping. Same class as `src/lib/extraction/prompts/savings.ts` above. New "co client ..." synonyms were added alongside, not in place of, the old ones.
  "src/lib/extraction/identify-household.ts", // 133 lines, 2 commits/90d. Only hit is the JSON extraction-schema prompt string sent to the model, `` '{"isHouseholdDoc": ..., "spouse"?: {...}, ...}' `` (:41) — an API/prompt schema key (Bucket C, same protection as the extraction JSON schema generally), not display copy. Framework-free extraction-pipeline file with no UI.
  "src/lib/extraction/__tests__/classify.test.ts", // 117 lines, 2 commits/90d. Both hits are fixture TEXT simulating a raw SOURCE DOCUMENT's own wording fed to `classifyDocument` ("Spouse Jane, date of birth 1970-01-01." at :77; "Spouse filing jointly" in a simulated Form 1040 excerpt at :103) — content from outside Foundry that a real fact-finder or tax return will say regardless of our vocabulary, the same reasoning that keeps `extraction/prompts/savings.ts` on this list.
  "src/lib/extraction/__tests__/will-prompt.test.ts", // 74 lines, 0 commits/90d. Only hit is a schema-fixture value, `recipientNameHint: "spouse Jane Doe"` (:37) — simulates what an AI extractor would echo back from a will's own wording, not display copy; the file's own `.toContain("spouse")` assertion (:21) is the bare Bucket C enum word already excluded by the scanner.
  "src/lib/imports/planner/__tests__/fixtures/manifest.ts", // 89 lines, 1 commit/90d. The `label` fields are "Human label[s] for the [`eval:planner`] eval output" (developer CLI tooling, never advisor/client-visible); its one hit is such a label, `"Two earners; spouse salary wrongly ends at death"` (:65). (The 2 quote-pairing artifacts that made up the rest of this reason are gone — the scanner no longer invents spans between adjacent literals.)

  // ── Task 11 (2026-09-11): every source file left in PENDING once the ratchet
  // stopped scanning tests. Each hit below was read in context; each is either
  // machine-facing or a scanner artifact, EXCEPT thresholds.ts, whose residual
  // hit is a genuine statutory term. The three files here that also had a real
  // display hit had it FIXED in this task, not allowlisted — the reason says so.
  "src/db/schema.ts", // Only hit is a column comment on `crm_household_contacts.role`, `` `role = 'spouse'` `` (:788) — the literal DB enum value. Bucket C: renaming the token would need a migration and would break every query that filters on it.
  "src/lib/crm/sort-order.ts", // Both hits are raw SQL, `and c.role = 'spouse' limit 1)` (:32, :34) — the literal `crm_household_contacts.role` enum value in a WHERE clause, the same DB token schema.ts is on this list for. New to the list only because the scanner can now read a template that spans a newline; the regex it replaced could not, and had never seen these.
  "src/lib/projection/resolve-entity.ts", // Only hit is a `console.warn` diagnostic, `[resolveExpenseFromRaw] ignoring endsAtMedicareEligibilityOwner="joint" — column is per-person; expected "client" or "spouse"` (:426) — a developer console message naming the two legal enum values, never rendered.
  "src/lib/tax/thresholds.ts", // The real display hit — `iraDeductCovered`'s label "IRA Contribution Deductibility - Covered Spouse" (:77) — was wrong on the facts as well as the vocabulary (it is the ACTIVE-PARTICIPANT phase-out of IRC §219(g)(5), applies to the taxpayer, and fires for single filers) and was renamed to "Covered by Workplace Plan" in this task. The residual hit is :78, `iraDeductSpousal`'s "Non-covered Spouse" — genuine IRC §219(g)(7), the spousal-IRA rule, which requires a MARRIED couple filing jointly. Renaming it would misstate the law. THRESHOLD_ITEMS is a fixed 11-row table mirroring eMoney's report, not a growing copy catalogue, so a file entry is safe here in a way it would not be for tax-analysis/findings/*.
  // ── Merge with origin/main (2026-09-11): Statement Chat landed after this
  // branch was cut. Its two real display hits — `ROLE_LABELS.spouse` in
  // `owner-cell.tsx` and the owner dropdown's `label: "Spouse"` in
  // `owner-cell-edit.tsx` — were renamed to `CO_CLIENT_LABEL` at merge time,
  // not allowlisted. These two are the machine-facing remainder.
  "src/lib/statement-chat/tools.ts", // Only hit is `fieldDomainDescription`'s `` `one of "client", "spouse", "joint"` `` (:152) — a tool-call validation message returned to the MODEL, enumerating the literal enum values it must emit for `ExtractedAccount.owner`. Its sibling cases return raw enum keys the same way (`Object.keys(ACCOUNT_CATEGORY_SET).join(", ")`), which is what marks this as schema vocabulary rather than advisor prose. Same class as `src/domain/forge/tools/`, allowlisted by prefix: renaming the word while the schema keeps `spouse` would add a mapping the model has to bridge, for no user-visible gain.
]);

/** Directory prefixes that are also allowlisted (Bucket C: machine-facing enum documentation). */
const ALLOWLIST_PREFIXES = [
  "src/lib/extraction/prompts/",
  "src/domain/forge/tools/",
  // Task 8 (2026-09-15): MCP tool descriptions, same class as
  // src/domain/forge/tools/ above — LLM-facing tool-schema prose, not
  // advisor- or client-visible UI copy. The model needs the precise kinship
  // word to answer correctly; CO_CLIENT_LABEL is a display-copy concern.
  "src/domain/mcp/tools/",
  // The Details field map (2026-09-23). Model-facing prose — `notes`,
  // `documentHints`, `aliases` and `surface` all describe a field TO THE
  // EXTRACTOR, and `surface` has no UI consumer at all. Same class as
  // `src/lib/extraction/prompts/` above. The one property here a person reads,
  // `label`, is gated structurally by "field map labels" below, NOT by this
  // exemption — see the header for why the file-level exemption alone would
  // have been too broad.
  "src/domain/forge/detail-fields/",
];

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

/** True when "spouse" survives with every term of art stripped out first.
 *
 *  Stripping and re-testing, rather than testing the whole string, is what
 *  stops one term of art from covering for an unprotected "Spouse" elsewhere in
 *  the same sentence: medicare/detectors/survivor-tier-shock.ts said "When the
 *  first spouse passes ... jumping the surviving spouse to tier N", and the
 *  protected "surviving spouse" hid "the first spouse" two clauses away. */
function hasBareSpouse(text: string): boolean {
  return /\bspouse\b/i.test(text.replace(TERMS_OF_ART, " "));
}

/**
 * Every run of text in a file that a person could read, straight off the parser.
 *
 * Only these node kinds carry text: a string literal (which covers JSX
 * attributes too — `aria-label="…"` is read aloud), the literal spans of a
 * template, and JSX text. Everything else in the file is code, comments or
 * interpolated expressions, and nobody reads those.
 *
 * `ScriptKind` follows the extension. Parsing a `.ts` file as TSX is not
 * harmless: `<T>`-style type assertions are read as JSX, and the recovery from
 * that invents literals spanning hundreds of lines — it reported a bogus hit in
 * `lib/intake/schema.ts` until this was keyed off the filename.
 */
function displayText(file: string, text: string): { text: string; pos: number }[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const found: { text: string; pos: number }[] = [];
  const visit = (node: ts.Node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.JsxText:
        found.push({ text: (node as ts.LiteralLikeNode).text, pos: node.getStart(source) });
        break;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function violations(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return displayText(file, text)
    .filter(({ text: literal }) => {
      if (!hasBareSpouse(literal)) return false;

      // The bare enum token, on its own: an object key, a comparison, a value
      // the database stores. Not a sentence.
      if (literal.trim() === "spouse") return false;

      // An identifier, slug, CSS token or path — `fm-spouse`, `spouse_dob`,
      // `./spouse-utils`. No whitespace anywhere, and never capitalised, which
      // is what separates these from a sentence that happens to be short.
      if (!/\bSpouse\b/.test(literal) && !/\s/.test(literal.trim())) return false;

      return true;
    })
    .map(({ text: literal, pos }) => {
      const line = text.slice(0, pos).split("\n").length;
      return `${line}: ${JSON.stringify(literal.trim().slice(0, 120))}`;
    });
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

  /**
   * What the prefix exemption above hands back.
   *
   * `src/domain/forge/detail-fields/` is exempt from the source scan because
   * its prose is written for the extraction model. This checks the registry
   * itself instead — the real export, so it cannot be fooled by how a string is
   * spelled, split or concatenated.
   *
   * Fail-CLOSED, and that polarity is the point: it walks EVERY string-valued
   * property and skips only the ones named below. A new property added to
   * `DetailEntity` or `DetailField` is therefore gated the day it appears.
   * Listing the checked properties instead would have left each new one ungated
   * by both tests with no diff for a reviewer to see — and `types.ts` has
   * gained a property in 3 of its last 4 commits. `surface` is the live example
   * of the risk: `types.ts` documents it as screen terms ("Insurance → Add
   * policy"), so the day something renders it as a breadcrumb, it is display
   * copy — and only the polarity of this list decides whether that ships.
   */
  const MODEL_FACING = new Set([
    // Prose the extraction model reads and no person does. `prompt-builder.ts`
    // puts `notes` and `aliases` in the prompt; `region-classifier.ts` uses
    // `documentHints`; `surface` has no consumer at all today.
    "notes",
    "aliases",
    "documentHints",
    "surface",
    // Identifiers, enum tokens, table names, route paths and schema handles.
    // These hold the literal `spouse` the database stores; renaming it would
    // need a migration, not a copy edit.
    "id",
    "key",
    "kind",
    "tab",
    "table",
    "identity",
    "writeCore",
    "appliesTo",
    "enumValues",
    "defaultValue",
    "payloadShape",
  ]);

  it("shows no field map label saying Spouse", () => {
    const check = (where: string, value: unknown): string[] => {
      const strings =
        typeof value === "string"
          ? [value]
          : Array.isArray(value) && value.every((v) => typeof v === "string")
            ? (value as string[])
            : [];
      return strings.filter(hasBareSpouse).map((v) => `${where}: ${JSON.stringify(v)}`);
    };

    const offenders = DETAIL_ENTITIES.flatMap((entity) => [
      ...Object.entries(entity)
        .filter(([k]) => !MODEL_FACING.has(k))
        .flatMap(([k, v]) => check(`${entity.id}.${k}`, v)),
      ...entity.fields.flatMap((field) =>
        Object.entries(field)
          .filter(([k]) => !MODEL_FACING.has(k))
          .flatMap(([k, v]) => check(`${entity.id}.${field.key}.${k}`, v)),
      ),
    ]);

    expect(
      offenders,
      "A Details field map property that is not in MODEL_FACING is read by a person. Say co-client.",
    ).toEqual([]);
  });
});
