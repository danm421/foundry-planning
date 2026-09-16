// src/lib/entity-extraction/__tests__/prompt-builder.test.ts
import { describe, it, expect } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { buildEntityPrompt } from "../prompt-builder";

const life = findEntity("life_insurance_policy")!;

describe("buildEntityPrompt", () => {
  it("names every writable field the create path accepts", () => {
    const { prompt } = buildEntityPrompt(life);
    expect(prompt).toContain("faceValue");
    expect(prompt).toContain("Death benefit");
  });

  it("lists an enum's values verbatim so the model cannot paraphrase", () => {
    const { prompt } = buildEntityPrompt(life);
    expect(prompt).toContain('"term"');
    expect(prompt).toContain('"universal"');
  });

  it("includes field aliases so a vendor wording is recognised", () => {
    const { prompt } = buildEntityPrompt(life);
    expect(prompt).toContain("Face Amount");
  });

  it("marks required fields", () => {
    const { prompt } = buildEntityPrompt(life);
    expect(prompt).toMatch(/faceValue[^\n]*REQUIRED/);
  });

  it("omits update-only fields entirely", () => {
    const entity = {
      ...life,
      fields: [
        { key: "name", label: "Name", kind: "string" as const, required: true },
        { key: "notes", label: "Notes", kind: "text" as const, appliesTo: "update" as const },
      ],
    };
    const { prompt } = buildEntityPrompt(entity);
    expect(prompt).toContain("name");
    expect(prompt).not.toContain("notes");
  });

  it("omits derived fields the server will not accept", () => {
    const entity = {
      ...life,
      fields: [
        { key: "name", label: "Name", kind: "string" as const, required: true },
        { key: "total", label: "Total", kind: "money" as const, writable: false },
      ],
    };
    const { prompt } = buildEntityPrompt(entity);
    expect(prompt).not.toContain("total");
  });

  it("states the rate-versus-percent rule, which is the 100x trap", () => {
    const { prompt } = buildEntityPrompt(life);
    expect(prompt).toMatch(/0\.03/);
    expect(prompt).toMatch(/decimal fraction/i);
  });

  it("asks for a verbatim snippet and a confidence with every value", () => {
    const { prompt } = buildEntityPrompt(life);
    expect(prompt).toContain('"snippet"');
    expect(prompt).toContain('"confidence"');
  });

  it("hashes the prompt so a map edit changes the cache key", () => {
    const before = buildEntityPrompt(life);
    const after = buildEntityPrompt({
      ...life,
      fields: [...life.fields, { key: "zzz", label: "Zzz", kind: "string" as const }],
    });
    expect(before.hash).toHaveLength(12);
    expect(after.hash).not.toBe(before.hash);
  });

  it("is deterministic — the same entity yields the same hash", () => {
    expect(buildEntityPrompt(life).hash).toBe(buildEntityPrompt(life).hash);
  });
});
