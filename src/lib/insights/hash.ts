// src/lib/insights/hash.ts
import { createHash } from "crypto";
import type { InsightsBattery } from "./battery";
import type { Signal } from "./signals";

/**
 * Signals whose text and `numbers` are derived from the wall clock rather than
 * from household data: they carry an elapsed count that ticks on its own.
 * Hashing that count makes the profile go stale every single day for exactly
 * the neglected households an advisor is least able to act on, which trains
 * everyone to ignore the flag. Their APPEARANCE and DISAPPEARANCE still move
 * the hash — that is a real change, and it is carried by the id alone.
 */
const CLOCK_DERIVED_SIGNAL_IDS = new Set(["relationship.stale_contact", "risk.review_due"]);

const hashableSignal = (s: Signal) =>
  CLOCK_DERIVED_SIGNAL_IDS.has(s.id) ? { id: s.id, severity: s.severity } : s;

/** Stable content hash of the deterministic battery — drives staleness. */
export function hashBattery(b: InsightsBattery): string {
  const material = {
    clientName: b.clientName,
    kpis: b.kpis,
    retirementPeople: b.retirementPeople,
    risk: b.risk,
    signals: b.signals.map(hashableSignal),
    mcBands: b.mcBands,
    goalsText: b.grounding.goalsText,
    notesText: b.grounding.notesText,
    allocation: b.grounding.allocation,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}
