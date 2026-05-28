import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import { presentationTemplates, firms } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  listTemplatesForUser,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "../templates-repo";

const FIRM_A = "test_firm_A";
const FIRM_B = "test_firm_B";
const USER_1 = "user_1";
const USER_2 = "user_2";

async function ensureFirms() {
  await db
    .insert(firms)
    .values([
      { firmId: FIRM_A, displayName: "Test Firm A" },
      { firmId: FIRM_B, displayName: "Test Firm B" },
    ])
    .onConflictDoNothing();
}

async function cleanupTemplates() {
  await db.delete(presentationTemplates).where(inArray(presentationTemplates.firmId, [FIRM_A, FIRM_B]));
}

async function cleanupFirms() {
  await db.delete(firms).where(inArray(firms.firmId, [FIRM_A, FIRM_B]));
}

beforeAll(ensureFirms);
beforeEach(cleanupTemplates);
afterAll(async () => {
  await cleanupTemplates();
  await cleanupFirms();
});

const validPages = [
  { pageId: "cashFlow" as const, options: { range: "retirement" as const, showCallout: true } },
];

describe("templates-repo", () => {
  it("creates a template and reads it back", async () => {
    const created = await createTemplate({
      firmId: FIRM_A,
      createdByUserId: USER_1,
      name: "Standard",
      visibility: "shared",
      pages: validPages,
    });
    const fetched = await getTemplateById(created.id, FIRM_A);
    expect(fetched?.name).toBe("Standard");
    expect(fetched?.visibility).toBe("shared");
  });

  it("listTemplatesForUser returns shared (all firm) + own private", async () => {
    await createTemplate({ firmId: FIRM_A, createdByUserId: USER_1, name: "S1", visibility: "shared", pages: validPages });
    await createTemplate({ firmId: FIRM_A, createdByUserId: USER_1, name: "P1", visibility: "private", pages: validPages });
    await createTemplate({ firmId: FIRM_A, createdByUserId: USER_2, name: "Other private", visibility: "private", pages: validPages });
    const { shared, mine } = await listTemplatesForUser(FIRM_A, USER_1);
    expect(shared.map((t) => t.name).sort()).toEqual(["S1"]);
    expect(mine.map((t) => t.name).sort()).toEqual(["P1"]);
  });

  it("scopes by firmId — does not leak across firms", async () => {
    await createTemplate({ firmId: FIRM_B, createdByUserId: USER_1, name: "Foreign", visibility: "shared", pages: validPages });
    const { shared } = await listTemplatesForUser(FIRM_A, USER_1);
    expect(shared.map((t) => t.name)).toEqual([]);
  });

  it("update modifies fields and bumps updatedAt", async () => {
    const created = await createTemplate({ firmId: FIRM_A, createdByUserId: USER_1, name: "n1", visibility: "private", pages: validPages });
    const updated = await updateTemplate(created.id, FIRM_A, { name: "n2" });
    expect(updated?.name).toBe("n2");
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime());
  });

  it("delete removes the row", async () => {
    const created = await createTemplate({ firmId: FIRM_A, createdByUserId: USER_1, name: "x", visibility: "private", pages: validPages });
    await deleteTemplate(created.id, FIRM_A);
    expect(await getTemplateById(created.id, FIRM_A)).toBeNull();
  });

  it("unique name within (firmId, visibility, createdByUserId) is enforced", async () => {
    await createTemplate({ firmId: FIRM_A, createdByUserId: USER_1, name: "dup", visibility: "private", pages: validPages });
    await expect(
      createTemplate({ firmId: FIRM_A, createdByUserId: USER_1, name: "dup", visibility: "private", pages: validPages }),
    ).rejects.toThrow();
  });
});
