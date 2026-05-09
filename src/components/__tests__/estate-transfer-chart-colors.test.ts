import { describe, it, expect } from "vitest";
import { assignRecipientColors } from "../estate-transfer-chart-colors";
import type { RecipientTotal } from "@/lib/estate/transfer-report";

const make = (
  key: string,
  recipientKind: RecipientTotal["recipientKind"],
  total = 1000,
): RecipientTotal => ({
  key,
  recipientLabel: key,
  recipientKind,
  fromFirstDeath: total,
  fromSecondDeath: 0,
  total,
});

describe("assignRecipientColors", () => {
  it("returns a hex color for each recipient keyed by RecipientTotal.key", () => {
    const totals = [
      make("spouse|s1", "spouse"),
      make("family|c1", "family_member"),
      make("ext|charity1", "external_beneficiary"),
      make("entity|trust1", "entity"),
    ];
    const colors = assignRecipientColors(totals);
    expect(Object.keys(colors).sort()).toEqual(
      ["entity|trust1", "ext|charity1", "family|c1", "spouse|s1"].sort(),
    );
    for (const c of Object.values(colors)) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("is deterministic for the same input", () => {
    const totals = [
      make("family|c1", "family_member"),
      make("family|c2", "family_member"),
    ];
    expect(assignRecipientColors(totals)).toEqual(assignRecipientColors(totals));
  });

  it("uses distinct palette families per recipientKind (no color collision across kinds)", () => {
    const totals = [
      make("spouse|s1", "spouse"),
      make("family|c1", "family_member"),
      make("ext|charity1", "external_beneficiary"),
      make("entity|trust1", "entity"),
    ];
    const colors = assignRecipientColors(totals);
    const all = Object.values(colors);
    expect(new Set(all).size).toBe(all.length);
  });

  it("rotates through palette slots within a kind without repeating until exhausted", () => {
    const totals = [
      make("family|c1", "family_member"),
      make("family|c2", "family_member"),
      make("family|c3", "family_member"),
    ];
    const colors = assignRecipientColors(totals);
    const fams = [
      colors["family|c1"],
      colors["family|c2"],
      colors["family|c3"],
    ];
    expect(new Set(fams).size).toBe(3);
  });
});
