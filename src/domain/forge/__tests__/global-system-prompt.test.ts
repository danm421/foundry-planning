import { describe, it, expect } from "vitest";
import { buildGlobalSystemPrompt } from "../global-system-prompt";

describe("buildGlobalSystemPrompt", () => {
  const prompt = buildGlobalSystemPrompt({ firmName: "Acme", advisorName: "Dana", todayISO: "2026-06-30" });

  it("frames Forge as a product-help assistant, not a client-plan assistant", () => {
    expect(prompt).toMatch(/help (the )?advisor.*(use|using).*Foundry/i);
    expect(prompt).not.toMatch(/Active client:/);
  });

  it("lists the help topic index so the model knows what exists", () => {
    expect(prompt).toContain("add-household — Add a new client or household");
  });

  it("instructs not to invent pages/buttons", () => {
    expect(prompt).toMatch(/never invent|only.*catalog|do not invent/i);
  });

  it("carries the firm + advisor + date tail", () => {
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("Dana");
    expect(prompt).toContain("2026-06-30");
  });
});
