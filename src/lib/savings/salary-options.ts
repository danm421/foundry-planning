import type { SalaryOption } from "@/components/forms/salary-basis-fields";

/**
 * Turn a plan's incomes into the salary checkboxes. Salaries only — the
 * engine's salary base has always meant `type === "salary"`, and widening it
 * would change what "% of salary" means on rules that already exist.
 * Entity-owned income is excluded for the same reason the engine excludes it:
 * a trust's salary can't ground a household deferral.
 */
export function toSalaryOptions(
  incomes: readonly {
    id: string;
    type: string;
    name: string;
    owner: string;
    ownerEntityId?: string | null;
  }[],
  ownerNames: { clientName: string; spouseName: string | null } | undefined,
): SalaryOption[] {
  const first = (full: string | null | undefined) => full?.split(" ")[0] ?? null;
  return incomes
    .filter((i) => i.type === "salary" && i.ownerEntityId == null)
    .map((i) => ({
      id: i.id,
      name: i.name,
      ownerLabel:
        i.owner === "spouse"
          ? (first(ownerNames?.spouseName) ?? "Spouse")
          : i.owner === "joint"
            ? "Joint"
            : (first(ownerNames?.clientName) ?? "Client"),
    }));
}
