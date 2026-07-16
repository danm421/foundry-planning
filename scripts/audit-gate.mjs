#!/usr/bin/env node
// Blocking supply-chain gate: fails when a PRODUCTION dependency carries a
// high/critical advisory that isn't explicitly accepted below. Dev-only deps
// are reported by `npm audit` / Dependabot but don't block — they never ship.
//
// Run locally: node scripts/audit-gate.mjs
// CI: .github/workflows/security.yml (PRs, pushes to main, weekly cron)

import { execFileSync } from "node:child_process";

// Accepted advisories — every entry documents why the risk doesn't reach us.
// Revisit when the parent dependency ships a fix (Dependabot will PR it);
// delete the entry once the advisory clears from `npm audit --omit=dev`.
const ALLOWLIST = new Map([
  // Example: ["GHSA-xxxx-xxxx-xxxx", "why this is unreachable in our usage"],
]);

let raw;
try {
  raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // npm audit exits non-zero when any vulnerability exists; JSON is still on stdout.
  raw = err.stdout;
  if (!raw) throw err;
}

const report = JSON.parse(raw);
const vulns = report.vulnerabilities ?? {};

const failures = [];
let accepted = 0;

for (const [name, vuln] of Object.entries(vulns)) {
  // `via` objects are advisories on this package itself; `via` strings mean
  // "vulnerable through another package", which has its own entry — skip those
  // so each advisory is judged exactly once, at its root.
  const advisories = (vuln.via ?? []).filter((v) => typeof v === "object");
  for (const adv of advisories) {
    if (adv.severity !== "high" && adv.severity !== "critical") continue;
    const id = String(adv.url ?? "").split("/").pop() ?? "";
    if (ALLOWLIST.has(id)) {
      accepted += 1;
      console.log(`accepted  ${name}: ${id} — ${ALLOWLIST.get(id)}`);
    } else {
      failures.push({ name, severity: adv.severity, id, title: adv.title });
    }
  }
}

if (failures.length > 0) {
  console.error("\nAudit gate FAILED — high/critical advisories on production deps:\n");
  for (const f of failures) {
    console.error(`  [${f.severity}] ${f.name}: ${f.title} (${f.id})`);
  }
  console.error(
    "\nFix with `npm audit fix`, a targeted override in package.json, or — only",
  );
  console.error(
    "with a written why-unreachable rationale — an ALLOWLIST entry in scripts/audit-gate.mjs.",
  );
  process.exit(1);
}

console.log(
  `Audit gate passed: no unaccepted high/critical advisories in production deps (${accepted} accepted).`,
);
