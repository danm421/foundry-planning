// src/domain/forge/__tests__/system-prompt-transcript.test.ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../system-prompt";

// Minimal valid ForgePromptContext — all required fields present (copied from system-prompt.test.ts fixture).
const base = {
  firmName: "Acme Advisors",
  client: { householdTitle: "The Smiths" },
  scenario: { name: "Base Case", isBaseCase: true },
};

describe("buildSystemPrompt pendingTranscript", () => {
  it("includes a summarize directive when a transcript is pending", () => {
    const out = buildSystemPrompt({ ...base, pendingTranscript: { transcriptId: "tr_42" } });
    expect(out).toContain("tr_42");
    expect(out).toMatch(/summarize_meeting_transcript/);
  });

  it("includes save_meeting_record directive in the transcript line", () => {
    const out = buildSystemPrompt({ ...base, pendingTranscript: { transcriptId: "tr_99" } });
    expect(out).toMatch(/save_meeting_record/);
  });

  it("instructs not to paste the transcript text into chat", () => {
    const out = buildSystemPrompt({ ...base, pendingTranscript: { transcriptId: "tr_1" } });
    expect(out).toMatch(/do not paste the transcript/i);
  });

  it("omits the transcript line when no pendingTranscript is set", () => {
    const out = buildSystemPrompt(base);
    expect(out).not.toMatch(/summarize_meeting_transcript/);
  });
});
