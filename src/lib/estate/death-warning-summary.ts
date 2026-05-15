/** Translates raw engine death-event warning codes into advisor-friendly,
 *  grouped notes for the Estate Flow Report.
 *
 *  The death-event engine emits diagnostic strings shaped `code:ref` (or
 *  `code: ref (detail)` for the trust codes). `ref` is an opaque account,
 *  policy, or entity id — useful for debugging, useless to an advisor. This
 *  module groups warnings by code, resolves ids to display names via
 *  `nameById`, and produces readable one-liners.
 *
 *  Unknown codes pass through verbatim so no signal is silently lost. */

export interface DeathWarningNote {
  /** Stable React key. */
  key: string;
  /** One-line headline an advisor can read. */
  message: string;
  /** Names this note covers (asset / policy names) — may be empty. */
  items: string[];
}

/** Split a raw warning into its code and reference parts. The engine uses
 *  both `code:ref` and `code: ref (detail)` forms — trimming handles both. */
function parseWarning(w: string): { code: string; ref: string } {
  const idx = w.indexOf(":");
  if (idx === -1) return { code: w.trim(), ref: "" };
  return { code: w.slice(0, idx).trim(), ref: w.slice(idx + 1).trim() };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Unique-preserving push. */
function addUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

export function summarizeDeathWarnings(
  warnings: string[],
  nameById: Map<string, string>,
): DeathWarningNote[] {
  const residual: string[] = [];
  const overAllocated: string[] = [];
  const lifeInsurance: string[] = [];
  const trustIncomplete: string[] = [];
  let trustPourOutCount = 0;
  let liabilityBequestCount = 0;
  const unknown: string[] = [];

  const nameFor = (ref: string): string => nameById.get(ref) ?? ref;

  for (const w of warnings) {
    const { code, ref } = parseWarning(w);
    switch (code) {
      case "residual_fallback_fired":
        addUnique(residual, nameFor(ref));
        break;
      case "over_allocation_in_will":
        addUnique(overAllocated, nameFor(ref));
        break;
      case "life_insurance_no_beneficiaries":
        addUnique(lifeInsurance, nameFor(ref));
        break;
      case "trust_beneficiaries_incomplete":
        addUnique(trustIncomplete, ref);
        break;
      case "trust_pour_out_fallback_fired":
        trustPourOutCount += 1;
        break;
      case "liability_bequest_target_missing":
      case "liability_bequest_ineligible":
      case "liability_bequest_no_recipients":
      case "liability_bequest_unsupported_recipient_kind":
        liabilityBequestCount += 1;
        break;
      default:
        unknown.push(w);
        break;
    }
  }

  const notes: DeathWarningNote[] = [];

  if (residual.length > 0) {
    const n = residual.length;
    notes.push({
      key: "residual_fallback_fired",
      message: `${n} ${plural(n, "asset has", "assets have")} no will or beneficiary instruction — distributed by default order`,
      items: residual,
    });
  }

  if (overAllocated.length > 0) {
    const n = overAllocated.length;
    notes.push({
      key: "over_allocation_in_will",
      message: `Will distributes more than 100% of ${n} ${plural(n, "asset", "assets")} — shares pro-rated to fit`,
      items: overAllocated,
    });
  }

  if (lifeInsurance.length > 0) {
    const n = lifeInsurance.length;
    notes.push({
      key: "life_insurance_no_beneficiaries",
      message: `${n} life insurance ${plural(n, "policy has", "policies have")} no beneficiary designation`,
      items: lifeInsurance,
    });
  }

  if (trustIncomplete.length > 0) {
    notes.push({
      key: "trust_beneficiaries_incomplete",
      message: "Trust beneficiary percentages do not total 100%",
      items: trustIncomplete,
    });
  }

  if (trustPourOutCount > 0) {
    notes.push({
      key: "trust_pour_out_fallback_fired",
      message: `${trustPourOutCount} ${plural(trustPourOutCount, "trust has", "trusts have")} no beneficiaries — assets distributed to other heirs`,
      items: [],
    });
  }

  if (liabilityBequestCount > 0) {
    notes.push({
      key: "liability_bequest",
      message: `${liabilityBequestCount} will liability ${plural(liabilityBequestCount, "bequest", "bequests")} could not be applied`,
      items: [],
    });
  }

  unknown.forEach((w, i) => {
    notes.push({ key: `unknown-${i}`, message: w, items: [] });
  });

  return notes;
}
