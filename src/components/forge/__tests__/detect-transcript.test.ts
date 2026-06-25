// src/components/forge/__tests__/detect-transcript.test.ts
import { describe, it, expect } from "vitest";
import { looksLikeTranscript } from "../detect-transcript";

const speakerTranscript = `
Advisor Dan: Thanks for coming in today, let's review your retirement plan.
Jane Client: Sure, I had a few questions about the Roth conversion.
Advisor Dan: Great, let's start there. The conversion would move about forty thousand.
Jane Client: And how does that affect my taxes this year?
Advisor Dan: Good question — it adds to ordinary income, so we should be careful.
`.repeat(3);

const vttTranscript = `WEBVTT

00:00:01.000 --> 00:00:04.000
Thanks for joining the annual review call today.

00:00:04.500 --> 00:00:08.000
Let's start by looking at your portfolio performance.`.repeat(3);

const emailPaste = `Hi Dan,

Following up on our conversation — could you send over the updated plan PDF when you get a chance? Also wanted to confirm next quarter's meeting.

Thanks,
Jane`;

describe("looksLikeTranscript", () => {
  it("flags a speaker-labelled transcript", () => {
    const r = looksLikeTranscript(speakerTranscript);
    expect(r.isCandidate).toBe(true);
    expect(r.wordCount).toBeGreaterThan(50);
  });
  it("flags a VTT/timestamped transcript", () => {
    expect(looksLikeTranscript(vttTranscript).isCandidate).toBe(true);
  });
  it("does NOT flag a short email", () => {
    expect(looksLikeTranscript(emailPaste).isCandidate).toBe(false);
  });
  it("does NOT flag short text even with one colon line", () => {
    expect(looksLikeTranscript("Note: call Jane back tomorrow.").isCandidate).toBe(false);
  });
});
