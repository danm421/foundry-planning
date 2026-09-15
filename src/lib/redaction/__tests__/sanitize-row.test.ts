import { describe, it, expect } from "vitest";
import { sanitizeRow } from "../sanitize-row";

describe("sanitizeRow (strict)", () => {
  it("redacts an SSN inside a plain string field", () => {
    expect(sanitizeRow({ note: "ssn 123-45-6789 on file" })).toEqual({
      note: "ssn [REDACTED-SSN] on file",
    });
  });

  it("masks accountNumber to last 4 and renames accountNumberRaw", () => {
    expect(sanitizeRow({ accountNumber: "12345678" })).toEqual({ accountNumber: "••••5678" });
    expect(sanitizeRow({ accountNumberRaw: "12345678" })).toEqual({ accountNumber: "••••5678" });
  });

  it("coerces a numeric account number instead of throwing", () => {
    expect(sanitizeRow({ accountNumber: 12345678 })).toEqual({ accountNumber: "••••5678" });
  });

  it("walks arrays and nested objects", () => {
    expect(
      sanitizeRow({ rows: [{ inner: { accountNumber: "99998888", memo: "111-22-3333" } }] }),
    ).toEqual({ rows: [{ inner: { accountNumber: "••••8888", memo: "[REDACTED-SSN]" } }] });
  });

  it("leaves non-string primitives alone", () => {
    expect(sanitizeRow({ n: 42, b: true, z: null })).toEqual({ n: 42, b: true, z: null });
  });

  it("defaults to strict when no mode is given", () => {
    expect(sanitizeRow({ accountNumber: "12345678" })).toEqual(
      sanitizeRow({ accountNumber: "12345678" }, "strict"),
    );
  });
});
