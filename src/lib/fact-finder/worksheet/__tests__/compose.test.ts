import { describe, expect, it } from "vitest";
import { emptyFactFinderState } from "../../state";
import type { FactFinderState, FFFileReading, FFRow } from "../../types";
import { composeRequest } from "../compose";

const files = [
  { id: "f1", name: "schwab.pdf" },
  { id: "f2", name: "notes.docx" },
];
const done = (reader: FFFileReading["reader"]): FFFileReading => ({ status: "done", reader, startedAt: "t" });
const ira: FFRow = {
  id: "r1",
  sourceFileIds: ["f1"],
  cells: { accountName: { value: "Joint IRA", by: "document", confidence: 0.99 }, currentValue: { value: 100, by: "document", confidence: 0.99 } },
};

function stateWith(readings: FactFinderState["readings"], extra: Partial<FactFinderState> = {}): FactFinderState {
  return { ...emptyFactFinderState(), readings, ...extra };
}

describe("composeRequest", () => {
  it("nothing new → no files, no message", () => {
    expect(composeRequest(stateWith({}), files)).toEqual({ fileIds: [], message: null });
    const s = stateWith({ f2: done("freeform") }, { worksheet: { tables: [], composedFileIds: ["f2"] } });
    expect(composeRequest(s, files)).toEqual({ fileIds: [], message: null });
  });

  it("a new free-form file asks for read_document", () => {
    const r = composeRequest(stateWith({ f2: done("freeform") }), files);
    expect(r.fileIds).toEqual(["f2"]);
    expect(r.message).toContain("read it with read_document");
    expect(r.message).toContain("notes.docx");
  });

  it("a new statement whose rows the derived tables show → its file id, no message", () => {
    const s = stateWith({ f1: done("statement") });
    s.sections.retirement = [ira];
    s.worksheet = { tables: [{ id: "t", title: "T", columns: [], rows: [{ id: "w", cells: {}, ref: { rowId: "r1" } }] }], composedFileIds: [] };
    expect(composeRequest(s, files)).toEqual({ fileIds: ["f1"], message: null });
  });

  it("a new statement with unshown rows lists them", () => {
    const s = stateWith({ f1: done("statement") });
    s.sections.retirement = [ira];
    const r = composeRequest(s, files);
    expect(r.fileIds).toEqual(["f1"]);
    expect(r.message).toContain("schwab.pdf");
    expect(r.message).toContain("- r1 [retirement] ");
    expect(r.message).toContain("Joint IRA");
  });

  it("ignores files still reading or failed", () => {
    const s = stateWith({ f1: { status: "reading", startedAt: "t" }, f2: { status: "failed", startedAt: "t" } });
    expect(composeRequest(s, files)).toEqual({ fileIds: [], message: null });
  });

  it("fences file names and row lines, redacting SSNs", () => {
    const r = composeRequest(stateWith({ f2: done("freeform") }), [{ id: "f2", name: "ssn 123-45-6789.pdf" }]);
    expect(r.message).toContain("<<<UNTRUSTED DATA");
    expect(r.message).not.toContain("123-45-6789");
  });
});
