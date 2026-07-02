import { describe, it, expect } from "vitest";
import { toSafeDisplayFilename } from "../safe-filename";

describe("toSafeDisplayFilename", () => {
  it("flattens path traversal to the basename", () => {
    expect(toSafeDisplayFilename("../../evil.txt")).toBe("evil.txt");
    expect(toSafeDisplayFilename("../../../etc/passwd")).toBe("passwd");
  });

  it("flattens Windows-style separators", () => {
    expect(toSafeDisplayFilename("..\\..\\evil.txt")).toBe("evil.txt");
    expect(toSafeDisplayFilename("C:\\Users\\victim\\evil.exe")).toBe("evil.exe");
  });

  it("strips control chars and quotes that break Content-Disposition", () => {
    expect(toSafeDisplayFilename('report\r\nX: "y".pdf')).toBe("report__X: _y_.pdf");
  });

  it("neutralizes leading dot runs so entries can't be '..'", () => {
    expect(toSafeDisplayFilename("..")).toBe("_");
    expect(toSafeDisplayFilename("..hidden.txt")).toBe("_hidden.txt");
  });

  it("falls back to 'file' when nothing survives", () => {
    expect(toSafeDisplayFilename("")).toBe("file");
    expect(toSafeDisplayFilename("a/b/")).toBe("file");
  });

  it("leaves ordinary human filenames untouched", () => {
    expect(toSafeDisplayFilename("Q3 Report (final).pdf")).toBe("Q3 Report (final).pdf");
    expect(toSafeDisplayFilename("statement.2026-06.pdf")).toBe("statement.2026-06.pdf");
  });
});
