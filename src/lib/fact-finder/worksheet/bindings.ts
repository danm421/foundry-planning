// src/lib/fact-finder/worksheet/bindings.ts
import { HOLDING_FIELDS, type FFHoldingField } from "../types";
import type { WsBinding } from "./types";

/** Reads the text form the model writes (`cell:<columnId>`, `holding:<field>`, `section`); null when it isn't one. */
export function parseBinding(text: string): WsBinding | null {
  const t = text.trim();
  if (t === "section") return { kind: "section" };
  if (t.startsWith("cell:")) {
    const columnId = t.slice("cell:".length);
    return columnId ? { kind: "cell", columnId } : null;
  }
  if (t.startsWith("holding:")) {
    const field = t.slice("holding:".length);
    return (HOLDING_FIELDS as readonly string[]).includes(field) ? { kind: "holding", field: field as FFHoldingField } : null;
  }
  return null;
}

export function bindingText(b: WsBinding): string {
  if (b.kind === "section") return "section";
  return b.kind === "cell" ? `cell:${b.columnId}` : `holding:${b.field}`;
}
