import { describe, it, expect } from "vitest";
import {
  feedbackSubmissionSchema,
  validateScreenshots,
  MAX_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
} from "../schema";

function file(name: string, type: string, size: number): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe("feedbackSubmissionSchema", () => {
  it("accepts a valid support submission", () => {
    const r = feedbackSubmissionSchema.safeParse({
      mode: "support",
      subject: "Cannot export PDF",
      message: "The export button spins forever.",
      pageUrl: "https://app.foundryplanning.com/clients/abc",
    });
    expect(r.success).toBe(true);
  });

  it("rejects support submission with empty subject", () => {
    const r = feedbackSubmissionSchema.safeParse({
      mode: "support",
      subject: "   ",
      message: "hi",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid feedback submission and requires a type", () => {
    expect(
      feedbackSubmissionSchema.safeParse({
        mode: "feedback",
        type: "bug",
        message: "Estate flow chart renders blank.",
      }).success,
    ).toBe(true);
    expect(
      feedbackSubmissionSchema.safeParse({
        mode: "feedback",
        message: "no type",
      }).success,
    ).toBe(false);
  });
});

describe("validateScreenshots", () => {
  it("accepts up to the limit of valid images", () => {
    const ok = validateScreenshots([
      file("a.png", "image/png", 1000),
      file("b.jpg", "image/jpeg", 1000),
    ]);
    expect(ok).toEqual({ ok: true });
  });

  it("rejects too many files", () => {
    const files = Array.from({ length: MAX_SCREENSHOTS + 1 }, (_, i) =>
      file(`s${i}.png`, "image/png", 10),
    );
    expect(validateScreenshots(files).ok).toBe(false);
  });

  it("rejects a file over the size cap", () => {
    const r = validateScreenshots([
      file("big.png", "image/png", MAX_SCREENSHOT_BYTES + 1),
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a non-image mime type", () => {
    const r = validateScreenshots([file("doc.pdf", "application/pdf", 10)]);
    expect(r.ok).toBe(false);
  });
});
