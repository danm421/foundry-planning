import { createHash, randomInt } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { betaCodes } from "@/db/schema";

// Crockford base32 — no I, L, O, U (avoids visual ambiguity).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 2;
const GROUP_LEN = 4;

/** A fresh single-use code, e.g. "FNDR-7K2P-9QX4". */
export function generateCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let s = "";
    for (let i = 0; i < GROUP_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return `FNDR-${groups.join("-")}`;
}

/**
 * Canonicalize user-entered text before hashing: uppercase, drop separators
 * and the FNDR prefix, and fold the chars a human is likely to mistype
 * (O->0, I/L->1) onto their Crockford equivalents.
 */
export function normalizeCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^FNDR/, "");
}

/** sha256 hex of the normalized code body. Stored in `beta_codes.code_hash`. */
export function hashCode(input: string): string {
  return createHash("sha256").update(normalizeCode(input)).digest("hex");
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

const DEFAULT_ENTITLEMENTS = ["ai_import"];

export type MintOptions = {
  count: number;
  entitlements?: string[];
  expiresAt?: Date | null;
  label?: string | null;
};

/** Generate `count` codes, insert their hashes, return the plaintext codes. */
export async function mintCodes(opts: MintOptions): Promise<string[]> {
  const entitlements = opts.entitlements ?? DEFAULT_ENTITLEMENTS;
  const codes = Array.from({ length: opts.count }, () => generateCode());
  await db.insert(betaCodes).values(
    codes.map((code) => ({
      codeHash: hashCode(code),
      label: opts.label ?? null,
      entitlements,
      expiresAt: opts.expiresAt ?? null,
    })),
  );
  return codes;
}

export type ValidateResult =
  | { valid: true; entitlements: string[] }
  | { valid: false; reason: "not_found" | "redeemed" | "revoked" | "expired" };

/** Read-only pre-check for the /beta form so testers don't sign up with a dead code. */
export async function validateCode(input: string): Promise<ValidateResult> {
  const hash = hashCode(input);
  const [row] = await db.select().from(betaCodes).where(eq(betaCodes.codeHash, hash)).limit(1);
  if (!row) return { valid: false, reason: "not_found" };
  if (row.revokedAt) return { valid: false, reason: "revoked" };
  if (row.redeemedAt) return { valid: false, reason: "redeemed" };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { valid: false, reason: "expired" };
  return { valid: true, entitlements: row.entitlements };
}

export type ClaimResult =
  | { ok: true; id: string; entitlements: string[] }
  | { ok: false; reason: "not_found" | "already_used" };

/**
 * Atomically claim a code for `userId`. The WHERE guard (unredeemed, not
 * revoked, not expired) means two concurrent claims can't both win — the
 * loser's UPDATE matches zero rows.
 */
export async function claimCode(input: string, userId: string): Promise<ClaimResult> {
  const hash = hashCode(input);
  const [row] = await db
    .update(betaCodes)
    .set({ redeemedAt: new Date(), redeemedByUserId: userId })
    .where(
      and(
        eq(betaCodes.codeHash, hash),
        isNull(betaCodes.redeemedAt),
        isNull(betaCodes.revokedAt),
        or(isNull(betaCodes.expiresAt), gt(betaCodes.expiresAt, new Date())),
      ),
    )
    .returning();
  if (!row) {
    const [exists] = await db
      .select({ id: betaCodes.id })
      .from(betaCodes)
      .where(eq(betaCodes.codeHash, hash))
      .limit(1);
    // A revoked or expired code that still exists also lands here and reports
    // already_used — claimCode is only reached after validateCode, which surfaces
    // those reasons distinctly, so the two-reason ClaimResult union is enough.
    return { ok: false, reason: exists ? "already_used" : "not_found" };
  }
  return { ok: true, id: row.id, entitlements: row.entitlements };
}

/** Fill in the created org id after the founder org exists. */
export async function finalizeCode(id: string, orgId: string): Promise<void> {
  await db.update(betaCodes).set({ redeemedOrgId: orgId }).where(eq(betaCodes.id, id));
}

/** Compensating reset if founder-org creation fails after a claim. */
export async function releaseCode(id: string): Promise<void> {
  await db
    .update(betaCodes)
    .set({ redeemedAt: null, redeemedByUserId: null, redeemedOrgId: null })
    .where(eq(betaCodes.id, id));
}

/** Revoke a code by id. Idempotent: returns the row, or undefined if already revoked / missing. */
export async function revokeCode(id: string): Promise<{ id: string } | undefined> {
  const [row] = await db
    .update(betaCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(betaCodes.id, id), isNull(betaCodes.revokedAt)))
    .returning({ id: betaCodes.id });
  return row;
}
