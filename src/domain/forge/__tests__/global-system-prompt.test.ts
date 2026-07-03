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

  it("tells global Forge it can create households/plans/tasks and must ask for required fields", () => {
    const p = buildGlobalSystemPrompt({ firmName: "Acme" });
    expect(p).toMatch(/create a (new )?household/i);
    expect(p).toMatch(/set up (a|the) plan/i);
    expect(p).toMatch(/ask/i); // gather-then-ask rule
    expect(p).toMatch(/approv/i); // confirmation framing
  });

  it("advertises start_walkthrough and lists the walkthrough index", () => {
    const p = buildGlobalSystemPrompt({ firmName: "Acme" });
    expect(p).toContain("start_walkthrough");
    expect(p).toContain("add-household — Add a new household");
  });

  it("advertises firm-wide task management (list, read with comments, create, update, complete)", () => {
    const p = buildGlobalSystemPrompt({ firmName: "Acme" });
    expect(p).toContain("tasks_list");
    expect(p).toContain("tasks_detail");
    expect(p).toContain("tasks_create");
    expect(p).toContain("firm_members");
    expect(p).not.toContain("create_task_for_client");
  });
});
