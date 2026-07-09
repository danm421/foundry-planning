import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmDocumentFolders } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  loadSharedSubtreeFolderIds,
  assertInSubtree,
  PortalVaultNotFoundError,
} from "../vault-context";

const ORG = "org_vault_ctx_test";
let householdId: string;
let rootId: string;
let childId: string;
let siblingId: string; // advisor-only folder OUTSIDE the shared subtree

beforeEach(async () => {
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db.insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: "u", name: "HH" }).returning();
  householdId = h.id;
  const [root] = await db.insert(crmDocumentFolders)
    .values({ householdId, firmId: ORG, name: "Shared with Client", isSystem: true, isPortalRoot: true })
    .returning({ id: crmDocumentFolders.id });
  rootId = root.id;
  const [child] = await db.insert(crmDocumentFolders)
    .values({ householdId, firmId: ORG, name: "Tax Docs", parentFolderId: rootId })
    .returning({ id: crmDocumentFolders.id });
  childId = child.id;
  const [sib] = await db.insert(crmDocumentFolders)
    .values({ householdId, firmId: ORG, name: "Transcripts", isSystem: true })
    .returning({ id: crmDocumentFolders.id });
  siblingId = sib.id;
});

describe("loadSharedSubtreeFolderIds", () => {
  it("includes the root and its descendants, excludes advisor-only siblings", async () => {
    const set = await loadSharedSubtreeFolderIds(householdId, rootId);
    expect(set.has(rootId)).toBe(true);
    expect(set.has(childId)).toBe(true);
    expect(set.has(siblingId)).toBe(false);
  });
});

describe("assertInSubtree", () => {
  it("passes for an in-subtree folder", () => {
    const set = new Set([rootId, childId]);
    expect(() => assertInSubtree(set, childId)).not.toThrow();
  });
  it("throws NotFound for null (vault root)", () => {
    const set = new Set([rootId]);
    expect(() => assertInSubtree(set, null)).toThrow(PortalVaultNotFoundError);
  });
  it("throws NotFound for an out-of-subtree folder", () => {
    const set = new Set([rootId]);
    expect(() => assertInSubtree(set, siblingId)).toThrow(PortalVaultNotFoundError);
  });
});
