// src/domain/forge/fact-finder-turn.ts
//
// The "[Attached fact finder]" turn — the compact identity + duplicate-match
// block the model reads to fill `ingest_fact_finder`'s arguments.
//
// This is PROMPT AND TOOL VOCABULARY, which is why it lives in the domain layer
// rather than in the panel that happens to send it:
//   • `global-system-prompt.ts` tells the model this exact block will arrive and
//     what to do with it, naming the "[Attached fact finder]" marker verbatim.
//   • Every key below mirrors the `ingest_fact_finder` schema in
//     `tools/global-actions.ts` — `spouseContact`, `spouseDob`,
//     `spouseRetirementAge`, and the same token again as a contact `role`.
// Those three files have to be read together to stay in step, and only two of
// them used to be greppable from the same place.
//
// The keys are machine-facing: no person ever reads this block. All three call
// sites pass `skipUserBubble: true`, which `use-forge-stream.ts:372` honours by
// not rendering a user bubble, so the block reaches the model and nothing else.
// Renaming the `spouse` key here while the tool schema keeps it would force the
// model to bridge a mapping on every fact-finder ingest for no visible gain.
//
// Pure by construction — no LangChain, no server imports — so the client panel
// imports it directly, the same way it already imports `navigate-allowlist.ts`.

/** Response shape of `POST /api/forge/fact-finder/identify` — the clientless
 *  identity "peek" that precedes a global attach-first ingest. Re-exported by
 *  `components/forge/use-forge-import.ts`, which performs the call. */
export interface FactFinderIdentifyResponse {
  isHouseholdDoc: boolean;
  identity?: {
    householdName: string;
    primary?: { firstName: string; lastName?: string; dateOfBirth?: string };
    spouse?: { firstName: string; lastName?: string; dateOfBirth?: string };
    dependents: { firstName: string; lastName?: string; dateOfBirth?: string }[];
    state?: string;
    filingStatus?: "single" | "married_joint" | "married_separate" | "head_of_household";
    retirementAge?: number;
    lifeExpectancy?: number;
  };
  duplicateCandidates: { householdId: string; clientId: string | null; name: string; status: string }[];
}

/** Render the identity + duplicate matches as the compact block the model reads
 *  to fill `ingest_fact_finder`'s args, prefixed by the advisor's own prompt. */
export function buildIngestTurnMessage(res: FactFinderIdentifyResponse, prompt: string): string {
  const id = res.identity!;
  const lines: string[] = ["[Attached fact finder]"];
  lines.push(`household: ${id.householdName}`);
  if (id.primary) lines.push(`primary: ${id.primary.firstName} ${id.primary.lastName ?? ""} (${id.primary.dateOfBirth ?? "DOB unknown"})`);
  if (id.spouse) lines.push(`spouse: ${id.spouse.firstName} ${id.spouse.lastName ?? ""} (${id.spouse.dateOfBirth ?? "DOB unknown"})`);
  if (id.state) lines.push(`state: ${id.state}`);
  if (id.filingStatus) lines.push(`filing: ${id.filingStatus}`);
  lines.push(
    res.duplicateCandidates.length === 0
      ? "No existing household matched."
      : `Possible existing matches: ${res.duplicateCandidates.map((c) => `${c.name} (clientId: ${c.clientId ?? "none"})`).join("; ")}`,
  );
  return `${prompt ? prompt + "\n\n" : ""}${lines.join("\n")}`;
}
