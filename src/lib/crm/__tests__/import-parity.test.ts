import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import { parseCsv, IMPORT_COLUMNS } from "../import";

// Parity fixtures for the xlsx (SheetJS) -> exceljs migration. These lock the
// parser contract across both input formats so the engine swap can't silently
// change what the import preview/commit UI receives:
//  - CSV: quoted fields, escaped quotes, CRLF, leading-zero postal strings.
//  - xlsx: string cells pass through verbatim, numeric postal cells recover
//    their leading zero, trailing-empty cells pad, real date cells parse to
//    the ISO string the advisor intended.

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn().mockResolvedValue("test_org_import_parity"),
  };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({
      userId: "test_user",
      orgId: "test_org_import_parity",
    }),
  };
});

const HEADER = IMPORT_COLUMNS.join(",");

type Cell = string | number | Date | null;

async function xlsxBuffer(rows: Cell[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const r of rows) ws.addRow(r);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

describe("parseCsv CSV parity", () => {
  it("parses quoted fields containing commas and escaped quotes", async () => {
    const buf = Buffer.from(
      [
        HEADER,
        `"Smith, Jones & Co",Jane,Smith,jane@example.com,,1980-01-01,,,,,advisor_1,active,"He said ""hi"", then left",123 Main,Austin,TX,73301`,
      ].join("\n"),
      "utf8",
    );
    const { proposed, errors } = await parseCsv(buf);
    expect(errors).toEqual([]);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].household.name).toBe("Smith, Jones & Co");
    expect(proposed[0].household.notes).toBe(`He said "hi", then left`);
  });

  it("handles CRLF line endings and keeps leading-zero postal strings", async () => {
    const buf = Buffer.from(
      [
        HEADER,
        "Crlf Family,Carl,Crlf,carl@example.com,,1985-03-04,,,,,advisor_1,prospect,,1 Beacon St,Boston,MA,02110",
      ].join("\r\n"),
      "utf8",
    );
    const { proposed, errors } = await parseCsv(buf);
    expect(errors).toEqual([]);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].primary.postalCode).toBe("02110");
    expect(proposed[0].primary.dateOfBirth).toBe("1985-03-04");
  });
});

describe("parseCsv xlsx parity", () => {
  it("parses string cells verbatim, pads numeric postal codes, and tolerates trailing-empty cells", async () => {
    const buf = await xlsxBuffer([
      [...IMPORT_COLUMNS],
      [
        "Xlsx Family",
        "Ann",
        "Lee",
        "ann@example.com",
        null,
        "1980-01-01",
        null,
        null,
        null,
        null,
        "advisor_1",
        "prospect",
        null,
        "9 Elm St",
        "Boston",
        "MA",
        2110, // numeric cell — must recover the leading zero
      ],
      // Trailing 6 cells absent entirely (xlsx truncates trailing empties).
      [
        "Trail Family",
        "Tom",
        "Trail",
        "tom@example.com",
        null,
        "1990-02-02",
        null,
        null,
        null,
        null,
        "advisor_1",
      ],
    ]);
    const { proposed, errors } = await parseCsv(buf);
    expect(errors).toEqual([]);
    expect(proposed).toHaveLength(2);
    expect(proposed[0].household.name).toBe("Xlsx Family");
    expect(proposed[0].primary.dateOfBirth).toBe("1980-01-01");
    expect(proposed[0].primary.postalCode).toBe("02110");
    expect(proposed[1].household.name).toBe("Trail Family");
    expect(proposed[1].household.status).toBe("prospect");
    expect(proposed[1].primary.postalCode).toBeUndefined();
    expect(proposed[1].spouse).toBeUndefined();
  });

  it("rejects an xlsx whose header row doesn't match the canonical columns", async () => {
    const buf = await xlsxBuffer([
      ["household_name", "primary_first"],
      ["Foo", "Bar"],
    ]);
    await expect(parseCsv(buf)).rejects.toThrow(/header/i);
  });

  it("parses real Excel date cells into the ISO date string the advisor intended", async () => {
    const buf = await xlsxBuffer([
      [...IMPORT_COLUMNS],
      [
        "Date Family",
        "Dora",
        "Date",
        "dora@example.com",
        null,
        new Date(Date.UTC(1979, 4, 12)), // true date cell, not text
        null,
        null,
        null,
        null,
        "advisor_1",
      ],
    ]);
    const { proposed, errors } = await parseCsv(buf);
    expect(errors).toEqual([]);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].primary.dateOfBirth).toBe("1979-05-12");
  });
});
