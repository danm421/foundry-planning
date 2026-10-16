// src/components/presentations/page-data.ts
//
// One deck page's data, exactly as its PDF sheet renders it — for the Claude
// connector's get_report_page_data, so a deck Claude builds itself quotes
// Foundry's own numbers. Same preparation as a real export
// (preparePresentation), same per-page build (buildPresentationEntries);
// nothing is rendered. AI-written commentary is not generated here.
import { buildPresentationEntries } from "./document";
import { preparePresentation, type ExportPdfBody } from "./render-presentation-pdf";

/** `body` holds exactly one page — the caller (the connector) builds it. */
export async function buildReportPageData(clientId: string, firmId: string, body: ExportPdfBody): Promise<unknown> {
  const { props } = await preparePresentation(clientId, firmId, body);
  // One page in, one entry out: a page its own facts would omit from a deck is
  // still built (document.tsx keeps the first page when every page is omitted).
  const [entry] = buildPresentationEntries(props);
  return stripBinary(entry.data);
}

/**
 * Page data without binary payloads — a logo travels as a base64 data URL, and
 * a model has no use for it — with Maps and Sets turned into plain JSON so they
 * survive the response instead of arriving as `{}`.
 */
export function stripBinary(value: unknown): unknown {
  if (typeof value === "string") return value.startsWith("data:") ? null : value;
  if (Array.isArray(value)) return value.map(stripBinary);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([k, v]) => [String(k), stripBinary(v)]));
  }
  if (value instanceof Set) return [...value].map(stripBinary);
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = k.endsWith("DataUrl") ? null : stripBinary(v);
    return out;
  }
  return value;
}
