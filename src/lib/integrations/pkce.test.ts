// src/lib/integrations/pkce.test.ts
import { describe, it, expect } from "vitest";
import { generatePkce, generateState } from "./pkce";

describe("integration pkce helpers", () => {
  it("generatePkce returns a non-empty verifier + challenge, unique per call", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(typeof a.verifier).toBe("string");
    expect(a.verifier.length).toBeGreaterThan(0);
    expect(typeof a.challenge).toBe("string");
    expect(a.challenge.length).toBeGreaterThan(0);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it("generateState is unguessable-ish (>=32 chars, unique)", () => {
    expect(generateState().length).toBeGreaterThanOrEqual(32);
    expect(generateState()).not.toBe(generateState());
  });
});
