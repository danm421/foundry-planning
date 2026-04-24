const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

export interface ParsedCsvRow {
  year: number;
  cashValue: number;
}

export interface ParseCashValueCsvResult {
  rows: ParsedCsvRow[];
  errors: string[];
}

export function parseCashValueCsv(csv: string): ParseCashValueCsvResult {
  const errors: string[] = [];
  const rows: ParsedCsvRow[] = [];

  const trimmed = csv.trim();
  if (!trimmed) {
    return { rows, errors: ["Empty CSV"] };
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) {
    return { rows, errors: ["CSV must have a header row and at least one data row"] };
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const yearIdx = headers.indexOf("year");
  const cashIdx = headers.indexOf("cash_value");

  if (yearIdx === -1) {
    return { rows, errors: ["Missing required header: year"] };
  }
  if (cashIdx === -1) {
    return { rows, errors: ["Missing required header: cash_value"] };
  }

  const seenYears = new Set<number>();
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;

    const rowNum = i + 1; // 1-indexed spreadsheet row (header is row 1)
    const cells = lines[i].split(",").map((c) => c.trim());

    if (cells.length < headers.length) {
      errors.push(`Row ${rowNum}: expected ${headers.length} columns, got ${cells.length}`);
      continue;
    }

    const yearStr = cells[yearIdx] ?? "";
    const cashStr = cells[cashIdx] ?? "";

    const year = Number(yearStr);
    const cashValue = Number(cashStr);

    if (!Number.isInteger(year)) {
      errors.push(`Row ${rowNum}: invalid year "${yearStr}" (must be a whole number)`);
      continue;
    }
    if (year < MIN_YEAR || year > MAX_YEAR) {
      errors.push(`Row ${rowNum}: year ${year} out of range (${MIN_YEAR}-${MAX_YEAR})`);
      continue;
    }
    if (Number.isNaN(cashValue) || cashValue < 0) {
      errors.push(`Row ${rowNum}: non-numeric or negative cash value "${cashStr}"`);
      continue;
    }
    if (seenYears.has(year)) {
      errors.push(`Row ${rowNum}: duplicate year ${year}`);
      continue;
    }

    seenYears.add(year);
    rows.push({ year, cashValue });
  }

  return { rows, errors };
}
