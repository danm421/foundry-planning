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

  // F1: `Date` has no own enumerable properties, so the generic object
  // branch used to silently rebuild it as `{}` — the exact shape every
  // drizzle timestamp column (createdAt/updatedAt/completedAt) takes.
  it("serializes a top-level Date to its ISO string, not {}", () => {
    const out = sanitizeRow(new Date("2026-01-02T03:04:05.000Z")) as string;
    expect(out).toBe("2026-01-02T03:04:05.000Z");
    expect(out).not.toEqual({});
  });

  it("serializes a nested Date field to its ISO string, not {}", () => {
    expect(sanitizeRow({ createdAt: new Date("2026-01-02T03:04:05.000Z") })).toEqual({
      createdAt: "2026-01-02T03:04:05.000Z",
    });
  });

  it("serializes a Date inside an array element, not {}", () => {
    expect(sanitizeRow([{ completedAt: new Date("2020-06-15T00:00:00.000Z") }])).toEqual([
      { completedAt: "2020-06-15T00:00:00.000Z" },
    ]);
  });

  it("unwraps a Set to a sanitized array, recursing into its elements", () => {
    expect(sanitizeRow({ tags: new Set(["a", "ssn 123-45-6789"]) })).toEqual({
      tags: ["a", "ssn [REDACTED-SSN]"],
    });
  });

  it("never exposes a full SSN or a full account number in either mode", () => {
    const row = { accountNumber: "12345678", note: "ssn 123-45-6789 on file" };
    for (const mode of ["strict", "identifiers-allowed"] as const) {
      expect(sanitizeRow(row, mode)).toEqual({
        accountNumber: "••••5678",
        note: "ssn [REDACTED-SSN] on file",
      });
    }
  });
});
