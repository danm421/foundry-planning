import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { firmBookSiloEnabled } from "../firm-settings";

const FIRM = "org_fsilo_test";

describe("firmBookSiloEnabled", () => {
  beforeEach(async () => {
    await db.delete(firms).where(eq(firms.firmId, FIRM));
  });

  it("defaults to false when the firm row is missing", async () => {
    expect(await firmBookSiloEnabled(FIRM)).toBe(false);
  });

  it("reflects the stored flag", async () => {
    await db.insert(firms).values({ firmId: FIRM, bookSiloEnabled: true });
    expect(await firmBookSiloEnabled(FIRM)).toBe(true);
  });
});
