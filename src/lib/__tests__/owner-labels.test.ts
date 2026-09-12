import { describe, it, expect } from "vitest";
import {
  CO_CLIENT_LABEL,
  personLabel,
  ownerOptions,
  individualOwnerLabel,
} from "../owner-labels";

const NAMED = { clientName: "Dana", spouseName: "Alex" };
const UNNAMED = { clientName: "Dana", spouseName: null };

describe("owner-labels", () => {
  it("uses the real name when there is one", () => {
    expect(personLabel("spouse", NAMED)).toBe("Alex");
    expect(personLabel("client", NAMED)).toBe("Dana");
  });

  it("falls back to Co-client, not Spouse", () => {
    expect(personLabel("spouse", UNNAMED)).toBe("Co-client");
    expect(CO_CLIENT_LABEL).toBe("Co-client");
  });

  it("never renders the word Spouse", () => {
    expect(personLabel("spouse", UNNAMED)).not.toMatch(/spouse/i);
    expect(individualOwnerLabel("spouse", UNNAMED)).not.toMatch(/spouse/i);
  });

  it("builds owner dropdown options in client, co-client, joint order", () => {
    expect(ownerOptions(NAMED)).toEqual([
      { value: "client", label: "Dana" },
      { value: "spouse", label: "Alex" },
      { value: "joint", label: "Joint" },
    ]);
    expect(ownerOptions(UNNAMED)).toEqual([
      { value: "client", label: "Dana" },
      { value: "spouse", label: "Co-client" },
      { value: "joint", label: "Joint" },
    ]);
  });
});
