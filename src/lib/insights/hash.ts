// src/lib/insights/hash.ts
import { createHash } from "crypto";
import type { InsightsBattery } from "./battery";

/** Stable content hash of the deterministic battery — drives staleness. */
export function hashBattery(b: InsightsBattery): string {
  const material = {
    clientName: b.clientName,
    kpis: b.kpis,
    risk: b.risk,
    goalsText: b.grounding.goalsText,
    notesText: b.grounding.notesText,
    allocation: b.grounding.allocation,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}
