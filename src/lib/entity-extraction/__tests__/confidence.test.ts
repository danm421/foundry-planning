import { describe, it, expect } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { scoreRow, REVIEW_THRESHOLD } from "../confidence";
import type { CandidateRow, Observation } from "../types";

const life = findEntity("life_insurance_policy")!;
const DOC = "Policy Summary\nFace Amount   $500,000\nInsured: Michael V Sharesky\nPolicy Type: Term";

function rowOf(values: Observation[]): CandidateRow {
  return { entityId: life.id, rowId: "r1", values, missingRequired: [], rowConfidence: 0 };
}

describe("scoreRow", () => {
  it("leaves a grounded, clean value at the model's own score", () => {
    const row = scoreRow({
      entity: life,
      row: rowOf([{ key: "faceValue", value: 500000, snippet: "Face Amount   $500,000", confidence: 0.97 }]),
      documentText: DOC,
    });
    expect(row.values[0].confidence).toBe(0.97);
    expect(row.values[0].issue).toBeUndefined();
  });

  it("grounds a snippet whose whitespace differs from the document", () => {
    const row = scoreRow({
      entity: life,
      row: rowOf([{ key: "faceValue", value: 500000, snippet: "Face Amount $500,000", confidence: 0.97 }]),
      documentText: DOC,
    });
    expect(row.values[0].issue).toBeUndefined();
  });

  it("caps and flags a value whose snippet is not in the document", () => {
    const row = scoreRow({
      entity: life,
      row: rowOf([{ key: "faceValue", value: 750000, snippet: "Face Amount $750,000", confidence: 0.99 }]),
      documentText: DOC,
    });
    expect(row.values[0].confidence).toBeLessThanOrEqual(0.5);
    expect(row.values[0].issue).toBe("ungrounded");
  });

  it("caps a value with no snippet at all", () => {
    const row = scoreRow({
      entity: life,
      row: rowOf([{ key: "faceValue", value: 500000, snippet: null, confidence: 0.99 }]),
      documentText: DOC,
    });
    expect(row.values[0].confidence).toBeLessThanOrEqual(0.5);
    expect(row.values[0].issue).toBe("ungrounded");
  });

  it("caps a value that already failed validation", () => {
    const row = scoreRow({
      entity: life,
      row: rowOf([{ key: "policyType", value: "Universal Life", snippet: "Policy Type: Term", confidence: 0.99, issue: "enum" }]),
      documentText: DOC,
    });
    expect(row.values[0].confidence).toBeLessThanOrEqual(0.3);
    expect(row.values[0].issue).toBe("enum");
  });

  it("never raises a score the model set low", () => {
    const row = scoreRow({
      entity: life,
      row: rowOf([{ key: "faceValue", value: 500000, snippet: "Face Amount   $500,000", confidence: 0.2 }]),
      documentText: DOC,
    });
    expect(row.values[0].confidence).toBe(0.2);
  });

  it("takes row confidence from the lowest required field", () => {
    const row = scoreRow({
      entity: life,
      row: rowOf([
        { key: "name", value: "Term 20", snippet: "Policy Summary", confidence: 0.99 },
        { key: "faceValue", value: 500000, snippet: "Face Amount   $500,000", confidence: 0.6 },
      ]),
      documentText: DOC,
    });
    expect(row.rowConfidence).toBe(0.6);
  });

  it("ignores an optional field when scoring the row", () => {
    const row = scoreRow({
      entity: life,
      row: rowOf([
        { key: "faceValue", value: 500000, snippet: "Face Amount   $500,000", confidence: 0.9 },
        { key: "costBasis", value: 1, snippet: "nowhere in the document", confidence: 0.1 },
      ]),
      documentText: DOC,
    });
    expect(row.rowConfidence).toBe(0.9);
  });

  it("scores a row with no required values present at zero", () => {
    const row = scoreRow({ entity: life, row: rowOf([]), documentText: DOC });
    expect(row.rowConfidence).toBe(0);
  });

  it("marks the review threshold at 0.7", () => {
    expect(REVIEW_THRESHOLD).toBe(0.7);
  });
});
