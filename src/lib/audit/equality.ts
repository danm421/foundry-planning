import type { AuditValue } from "./types";

export function isAuditValueEqual(a: AuditValue, b: AuditValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => isAuditValueEqual(item, b[i]!));
  }

  if (typeof a === "object" || typeof b === "object") {
    if (typeof a !== "object" || typeof b !== "object") return false;
    return a.id === b.id && a.display === b.display;
  }

  return false;
}
