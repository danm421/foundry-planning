// src/lib/fact-finder/__tests__/section-reader.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/entity-extraction/region-classifier", () => ({ classifyRegions: vi.fn() }));
vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: vi.fn() }));

import { classifyRegions } from "@/lib/entity-extraction/region-classifier";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import { findSection } from "../schema";
import { readSections, readingsFromSectionReply } from "../readers/section-reader";

beforeEach(() => vi.resetAllMocks());

const region = "Retirement: Fidelity 401(k) balance $1.2M as of Aug 1, 2041. Growth 6.5%. Inherited from Ann (Age 28 (Aug 2026)).";

describe("readingsFromSectionReply", () => {
  it("normalizes values to fact finder terms and keeps their source", () => {
    const { readings } = readingsFromSectionReply({
      section: findSection("retirement")!,
      fileId: "f1",
      firstPage: 3,
      regionText: region,
      reply: {
        rows: [
          {
            accountName: { value: "Fidelity 401(k)", snippet: "Fidelity 401(k)", confidence: 0.9 },
            currentValue: { value: "$1.2M", snippet: "balance $1.2M", confidence: 0.8 },
            accountType: { value: "401k", snippet: "401(k)", confidence: 0.9 },
          },
        ],
      },
    });
    expect(readings).toEqual([
      {
        sectionId: "retirement",
        fileId: "f1",
        cells: {
          accountName: { value: "Fidelity 401(k)", confidence: 0.9, source: { fileId: "f1", page: 3, snippet: "Fidelity 401(k)" } },
          currentValue: { value: 1_200_000, confidence: 0.8, source: { fileId: "f1", page: 3, snippet: "balance $1.2M" } },
          accountType: { value: "401(k)", confidence: 0.9, source: { fileId: "f1", page: 3, snippet: "401(k)" } },
        },
      },
    ]);
  });

  it("keeps what won't parse as text at 0.3, and caps an ungrounded value at 0.5", () => {
    const { readings } = readingsFromSectionReply({
      section: findSection("family")!,
      fileId: "f1",
      firstPage: 1,
      regionText: region,
      reply: {
        rows: [
          {
            firstName: { value: "Ann", snippet: "Inherited from Ann", confidence: 0.9 },
            dateOfBirth: { value: "Age 28 (Aug 2026)", snippet: "Age 28 (Aug 2026)", confidence: 0.9 },
            lastName: { value: "Smith", snippet: "Ann Smith", confidence: 0.95 },
          },
        ],
      },
    });
    const cells = readings[0].cells;
    expect(cells.dateOfBirth).toMatchObject({ value: "Age 28 (Aug 2026)", confidence: 0.3, issue: "unparsed" });
    expect(cells.lastName.confidence).toBe(0.5);
    expect(cells.firstName.confidence).toBe(0.9);
  });

  it("needs a recognizable _row on fixed-row sections, and accepts bare values", () => {
    const { readings, warnings } = readingsFromSectionReply({
      section: findSection("ss")!,
      fileId: "f1",
      firstPage: 1,
      regionText: "monthly benefit 3100",
      reply: { rows: [{ _row: "spouse", monthlyBenefit: 3100 }, { monthlyBenefit: 2000 }] },
    });
    expect(readings).toHaveLength(1);
    expect(readings[0].fixedRow).toBe("Co-client");
    expect(readings[0].cells.monthlyBenefit).toEqual({ value: 3100, confidence: 0.5, source: { fileId: "f1", page: 1 } });
    expect(warnings).toEqual(["Skipped a Social Security row that didn't say whose it is."]);
  });

  it("flags an off-list choice instead of dropping it", () => {
    const { readings } = readingsFromSectionReply({
      section: findSection("trusts")!,
      fileId: "f1",
      firstPage: 1,
      regionText: "Smith Trust grantor: joint",
      reply: { rows: [{ trustName: "Smith Trust", grantor: { value: "Joint", snippet: "grantor: joint", confidence: 0.9 } }] },
    });
    expect(readings[0].cells.grantor).toMatchObject({ value: "Joint", issue: "notAnOption", confidence: 0.3 });
  });

  it("throws on a reply with no rows (the caller turns it into a warning)", () => {
    expect(() =>
      readingsFromSectionReply({ section: findSection("cash")!, fileId: "f1", firstPage: 1, regionText: "", reply: { accounts: [] } }),
    ).toThrow(/no rows/);
  });
});

describe("readSections", () => {
  const pages = ["Page one: Client SSN 123-45-6789", "Retirement accounts: Fidelity 401(k) $640,000", "Life insurance: Term 20"];

  it("redacts SSNs before any model sees the text, and isolates a failing section", async () => {
    vi.mocked(classifyRegions).mockResolvedValue({ retirement: [[2, 2]], life: [[3, 3]] });
    vi.mocked(callAIExtraction).mockImplementation(async (system) => {
      if (system.includes('"Life Insurance"')) throw new Error("model timed out");
      return JSON.stringify({ rows: [{ accountName: { value: "Fidelity 401(k)", snippet: "Fidelity 401(k)", confidence: 0.9 } }] });
    });

    const out = await readSections({ fileId: "f1", pages });

    const classifierArgs = vi.mocked(classifyRegions).mock.calls[0][0];
    expect(classifierArgs.outline + classifierArgs.anchors).not.toContain("123-45-6789");
    for (const [, user] of vi.mocked(callAIExtraction).mock.calls) {
      expect(user).not.toContain("123-45-6789");
      expect(user).toContain("<document>");
    }
    expect(out.readings.map((r) => r.sectionId)).toEqual(["retirement"]);
    expect(out.readings[0].cells.accountName.source.page).toBe(2);
    expect(out.warnings).toEqual(["Could not read Life Insurance: model timed out"]);
  });

  it("fails, so the file can be retried, when finding the sections fails", async () => {
    vi.mocked(classifyRegions).mockResolvedValue(null);
    await expect(readSections({ fileId: "f1", pages })).rejects.toThrow("Couldn't read this document — try again.");
    expect(callAIExtraction).not.toHaveBeenCalled();
  });

  it("fails, so the file can be retried, when every section read fails", async () => {
    vi.mocked(classifyRegions).mockResolvedValue({ retirement: [[2, 2]], life: [[3, 3]] });
    vi.mocked(callAIExtraction).mockRejectedValue(new Error("429 Too Many Requests"));
    await expect(readSections({ fileId: "f1", pages })).rejects.toThrow("Couldn't read this document — try again.");
  });
});
