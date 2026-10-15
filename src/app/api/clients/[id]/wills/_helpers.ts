import type { WillBequestInput } from "@/lib/schemas/wills";

/** Per-account/entity soft-warning: specific bequests over-allocating one account or entity at one condition. */
export function computeSoftWarnings(bequests: WillBequestInput[]): string[] {
  const byKey = new Map<string, number>();
  for (const b of bequests) {
    if (b.kind !== "asset" || b.assetMode !== "specific") continue;
    if (b.accountId) {
      const key = `account:${b.accountId}|${b.condition}`;
      byKey.set(key, (byKey.get(key) ?? 0) + b.percentage);
    } else if (b.entityId) {
      const key = `entity:${b.entityId}|${b.condition}`;
      byKey.set(key, (byKey.get(key) ?? 0) + b.percentage);
    }
  }
  const out: string[] = [];
  for (const [key, sum] of byKey.entries()) {
    if (sum > 100.01) {
      const [prefixedId, condition] = key.split("|");
      const [prefix, id] = prefixedId.split(":");
      const label = prefix === "entity" ? "Entity" : "Account";
      out.push(
        `${label} ${id} is over-allocated at condition '${condition}' (${sum.toFixed(2)}%)`,
      );
    }
  }
  return out;
}
