import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public endpoint — browsers POST CSP violation reports here with no
// session. Must stay in the public-route list in middleware.
// Payloads come in two flavors:
//   - `application/csp-report` (legacy report-uri)
//   - `application/reports+json` (modern Reporting API / report-to)
// We log a compact, non-PII summary for the ops team to review while
// CSP runs in Report-Only mode. Once violations settle down, flip the
// header in next.config.ts from Content-Security-Policy-Report-Only to
// Content-Security-Policy.

type LegacyReport = {
  "csp-report"?: Record<string, unknown>;
};

type ModernReport = {
  type?: string;
  url?: string;
  body?: Record<string, unknown>;
};

function summarize(report: Record<string, unknown>): Record<string, unknown> {
  // Whitelist the fields we care about. Avoid echoing arbitrary
  // attacker-controlled strings into logs verbatim.
  const pick = (k: string): string | undefined => {
    const v = report[k];
    if (typeof v !== "string") return undefined;
    return v.slice(0, 300).replace(/[\r\n]+/g, " ");
  };
  return {
    blockedUri: pick("blocked-uri") ?? pick("blockedURL"),
    violatedDirective: pick("violated-directive") ?? pick("effectiveDirective"),
    documentUri: pick("document-uri") ?? pick("documentURL"),
    referrer: pick("referrer"),
    sourceFile: pick("source-file") ?? pick("sourceFile"),
    lineNumber: typeof report["line-number"] === "number"
      ? report["line-number"]
      : typeof report["lineNumber"] === "number"
      ? report["lineNumber"]
      : undefined,
    disposition: pick("disposition"),
  };
}

export async function POST(request: NextRequest) {
  try {
    const ct = request.headers.get("content-type") ?? "";
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return new NextResponse(null, { status: 204 });
    }

    if (Array.isArray(raw)) {
      for (const entry of raw as ModernReport[]) {
        if (entry?.body && typeof entry.body === "object") {
          console.warn("[csp-report]", summarize(entry.body));
        }
      }
    } else if ("csp-report" in (raw as LegacyReport)) {
      const legacy = (raw as LegacyReport)["csp-report"];
      if (legacy) console.warn("[csp-report]", summarize(legacy));
    } else {
      // Unknown shape — log content-type so we can spot new formats.
      console.warn("[csp-report] unknown shape", {
        contentType: ct.slice(0, 100),
      });
    }
  } catch (err) {
    console.error(
      "[csp-report] handler error:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown"
    );
  }
  // Always 204 — CSP reporters ignore the body; any non-2xx just makes
  // browsers noisy without helping us.
  return new NextResponse(null, { status: 204 });
}
