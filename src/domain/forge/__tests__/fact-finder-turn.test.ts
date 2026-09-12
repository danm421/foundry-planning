import { describe, it, expect } from "vitest";
import { buildIngestTurnMessage } from "../fact-finder-turn";

/**
 * Characterisation test for a block that had none while it lived 100 lines into
 * a 1,571-line chat component. Behaviour is unchanged by the extraction — what
 * this pins is the CONTRACT the block has with `global-system-prompt.ts` (the
 * "[Attached fact finder]" marker) and with `ingest_fact_finder`'s arg names.
 */
const identity = {
  householdName: "The Warners",
  primary: { firstName: "Cooper", lastName: "Warner", dateOfBirth: "1968-04-02" },
  spouse: { firstName: "Susan", lastName: "Warner", dateOfBirth: "1970-11-15" },
  dependents: [],
  state: "CO",
  filingStatus: "married_joint" as const,
};

describe("buildIngestTurnMessage", () => {
  it("leads with the marker the global system prompt tells the model to expect", () => {
    const msg = buildIngestTurnMessage({ isHouseholdDoc: true, identity, duplicateCandidates: [] }, "");
    expect(msg.split("\n")[0]).toBe("[Attached fact finder]");
  });

  it("carries both people and the household facts the ingest tool needs", () => {
    const msg = buildIngestTurnMessage({ isHouseholdDoc: true, identity, duplicateCandidates: [] }, "");
    expect(msg).toContain("household: The Warners");
    expect(msg).toContain("primary: Cooper Warner (1968-04-02)");
    expect(msg).toContain("Susan Warner (1970-11-15)");
    expect(msg).toContain("state: CO");
    expect(msg).toContain("filing: married_joint");
    expect(msg).toContain("No existing household matched.");
  });

  it("puts the advisor's own prompt first, separated from the block", () => {
    const msg = buildIngestTurnMessage(
      { isHouseholdDoc: true, identity, duplicateCandidates: [] },
      "Update the Warners.",
    );
    expect(msg.startsWith("Update the Warners.\n\n[Attached fact finder]")).toBe(true);
  });

  it("lists duplicate candidates with the clientId the model must pass back", () => {
    const msg = buildIngestTurnMessage(
      {
        isHouseholdDoc: true,
        identity,
        duplicateCandidates: [
          { householdId: "h1", clientId: "c1", name: "Warner Household", status: "active" },
          { householdId: "h2", clientId: null, name: "Warner, C.", status: "prospect" },
        ],
      },
      "",
    );
    expect(msg).toContain("Possible existing matches: Warner Household (clientId: c1); Warner, C. (clientId: none)");
  });

  it("omits a line for a fact the extractor did not find", () => {
    const msg = buildIngestTurnMessage(
      { isHouseholdDoc: true, identity: { householdName: "Solo", dependents: [] }, duplicateCandidates: [] },
      "",
    );
    expect(msg).not.toContain("primary:");
    expect(msg).not.toContain("state:");
    expect(msg).not.toContain("filing:");
  });
});
