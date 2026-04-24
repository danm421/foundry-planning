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
    const rowNum = i + 1; // 1-indexed spreadsheet row (header is row 1)
    const cells = lines[i].split(",").map((c) => c.trim());
    const yearStr = cells[yearIdx] ?? "";
    const cashStr = cells[cashIdx] ?? "";

    const year = Number(yearStr);
    const cashValue = Number(cashStr);

    if (!Number.isInteger(year) || Number.isNaN(year)) {
      errors.push(`Row ${rowNum}: non-numeric year "${yearStr}"`);
      continue;
    }
    if (year < 1900 || year > 2200) {
      errors.push(`Row ${rowNum}: year ${year} out of range (1900-2200)`);
      continue;
    }
    if (Number.isNaN(cashValue) || cashValue < 0) {
      errors.push(`Row ${rowNum}: non-numeric or negative cash_value "${cashStr}"`);
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
