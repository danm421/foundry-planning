import {
  FACT_FINDER_SECTIONS,
  PDF_HOLDINGS_TABLE,
  fixedLabelsOf,
  pdfKeysOf,
  type FFColumn,
  type FFSection,
} from "../schema";
import { normalizeCell } from "../normalize";
import type { FFReadCell, FFReadHolding, FFReaderOutput, FFReading, FFUnassignedReading } from "../types";

/** `<pdfKey>_r<row>_c<col>` — transposed tables: r = field, c = policy. */
export const FIELD_PATTERN = /^([a-z_0-9]+?)_r(\d+)_c(\d+)$/;

export interface FormField {
  name: string;
  type: string;
  value: string;
  /** 1-based page, or null when the PDF doesn't say. */
  page: number | null;
}

export interface FormContents {
  title: string | null;
  author: string | null;
  fields: FormField[];
}

const FORM_TIMEOUT_MS = 20_000;
/** A value the PDF holds that won't normalize (e.g. an option an older copy offered). */
const UNREADABLE_CONFIDENCE = 0.3;

function fieldValue(v: unknown): string {
  if (Array.isArray(v)) return v.length > 0 ? String(v[0]) : "";
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "Off";
  return String(v);
}

/** AcroForm values + document info via unpdf (pdfjs). Null on any failure — a non-form file is simply not ours. */
export async function readFormFields(buffer: Buffer): Promise<FormContents | null> {
  if (buffer.length === 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const work = (async (): Promise<FormContents> => {
      const doc = await getDocumentProxy(new Uint8Array(buffer));
      const [meta, objects] = await Promise.all([doc.getMetadata(), doc.getFieldObjects()]);
      const info = (meta.info ?? {}) as { Title?: unknown; Author?: unknown };
      const fields: FormField[] = [];
      for (const [name, widgets] of Object.entries(objects ?? {})) {
        const first = widgets[0] as { type?: unknown; value?: unknown; page?: unknown } | undefined;
        if (!first) continue;
        fields.push({
          name,
          type: String(first.type ?? ""),
          value: fieldValue(first.value),
          page: typeof first.page === "number" ? first.page + 1 : null,
        });
      }
      return {
        title: typeof info.Title === "string" ? info.Title : null,
        author: typeof info.Author === "string" ? info.Author : null,
        fields,
      };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PDF form read timed out")), FORM_TIMEOUT_MS);
    });
    return await Promise.race([work, timeout]);
  } catch (err) {
    console.warn("[form-reader] could not read form fields:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isOurFactFinder(form: FormContents): boolean {
  return (
    form.title === "Client Fact Finder" &&
    form.author === "Foundry Planning" &&
    form.fields.some((f) => FIELD_PATTERN.test(f.name))
  );
}

const SECTION_BY_KEY = new Map<string, FFSection>();
for (const section of FACT_FINDER_SECTIONS) for (const key of pdfKeysOf(section)) SECTION_BY_KEY.set(key, section);
const NOTES_SECTIONS = new Map(FACT_FINDER_SECTIONS.filter((s) => s.layout === "notes").map((s) => [s.id, s]));

interface Slot {
  section: FFSection;
  column: FFColumn;
  group: string;
  fixedRow?: string;
}

function slotFor(field: FormField): Slot | { holdingsRow: number; column: FFColumn } | null {
  const notes = NOTES_SECTIONS.get(field.name);
  if (notes) return { section: notes, column: notes.columns[0], group: notes.id, fixedRow: fixedLabelsOf(notes)[0] };
  const m = FIELD_PATTERN.exec(field.name);
  if (!m) return null;
  const key = m[1];
  const r = Number(m[2]);
  const c = Number(m[3]);
  if (key === PDF_HOLDINGS_TABLE.pdfKey) {
    const column = PDF_HOLDINGS_TABLE.columns.find((col) => col.pdfIndex === c);
    return column ? { holdingsRow: r, column: column as FFColumn } : null;
  }
  const section = SECTION_BY_KEY.get(key);
  if (!section) return null;
  if (section.layout === "transposed") {
    const column = section.columns.find((col) => col.pdfIndex === r);
    return column ? { section, column, group: `${section.id}#${c}` } : null;
  }
  const column = section.columns.find((col) => col.pdfIndex === c);
  if (!column) return null;
  if (section.layout === "fixedRows") {
    const label = section.fixedRows?.[r - 1];
    return label ? { section, column, group: `${section.id}#${label}`, fixedRow: label } : null;
  }
  return { section, column, group: `${key}#${r}` };
}

function readCell(column: FFColumn, field: FormField, fileId: string): FFReadCell | null {
  const text = field.value.trim();
  if (text === "" || text === "Off") return null;
  const source = { fileId, ...(field.page !== null ? { page: field.page } : {}) };
  const result = normalizeCell(column, text);
  if (result.ok) return result.value === null ? null : { value: result.value, confidence: 1, source };
  return { value: result.text, confidence: UNREADABLE_CONFIDENCE, source, issue: result.issue };
}

const HOLDING_KEYS: Record<string, keyof FFReadHolding> = {
  ticker: "ticker",
  securityName: "name",
  shares: "shares",
  price: "price",
  marketValue: "marketValue",
  costBasis: "costBasis",
};

/** Pure: form fields → readings. Field order doesn't matter. */
export function readingsFromFormFields(fileId: string, fields: FormField[]): FFReaderOutput {
  const groups = new Map<string, FFReading>();
  const warnings: string[] = [];
  const holdingRows = new Map<number, { hint: string; holding: FFReadHolding; page: number | null }>();

  for (const field of fields) {
    const slot = slotFor(field);
    if (!slot) continue;
    const cell = readCell(slot.column, field, fileId);
    if (!cell) continue;

    if ("holdingsRow" in slot) {
      const entry = holdingRows.get(slot.holdingsRow) ?? { hint: "", holding: {}, page: field.page };
      if (slot.column.id === "account") entry.hint = String(cell.value);
      else {
        const k = HOLDING_KEYS[slot.column.id];
        if (k === "ticker" || k === "name") entry.holding[k] = String(cell.value);
        else if (k && typeof cell.value === "number") entry.holding[k] = cell.value;
        else if (k && cell.issue) {
          // FFReadHolding can't carry text, so say so rather than drop it silently.
          warnings.push(`Holdings row ${slot.holdingsRow}: couldn't read ${slot.column.label} "${String(cell.value)}".`);
        }
      }
      holdingRows.set(slot.holdingsRow, entry);
      continue;
    }

    const reading: FFReading = groups.get(slot.group) ?? {
      sectionId: slot.section.id,
      ...(slot.fixedRow ? { fixedRow: slot.fixedRow } : {}),
      fileId,
      cells: {},
    };
    reading.cells[slot.column.id] = cell;
    groups.set(slot.group, reading);
  }

  const readings = [...groups.values()].filter(
    (r) => !(r.sectionId === "living_items" && r.cells.amount === undefined),
  );
  const unassignedHoldings: FFUnassignedReading[] = [...holdingRows.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, h]) => Object.keys(h.holding).length > 0)
    .map(([, h]) => ({
      fileId,
      accountHint: h.hint,
      holding: h.holding,
      source: { fileId, ...(h.page !== null ? { page: h.page } : {}) },
    }));
  return { readings, unassignedHoldings, warnings };
}
