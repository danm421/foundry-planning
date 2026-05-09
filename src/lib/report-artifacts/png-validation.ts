// SSRF hardening: @react-pdf/renderer fetches any URL passed as Image src,
// which would reach IMDS and internal hosts. Accept only data: PNG URIs
// with a hard size cap. Lifted from balance-sheet-report/export-pdf.
const MAX_PAYLOAD = 2_000_000;

export function isSafePngDataUri(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.startsWith("data:image/png;base64,") &&
    v.length < MAX_PAYLOAD
  );
}
