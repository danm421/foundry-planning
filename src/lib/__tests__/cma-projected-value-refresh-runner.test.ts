import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { assetClasses, cmaSets, cmaSetValues } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { seedCmaForFirm } from "../cma-seed-runner";
import {
  refreshFirmProjectedValues,
  buildProjectedValueRefreshPreviewForFirm,
  ProjectedValueRefreshError,
} from "../cma-projected-value-refresh-runner";

const testFirms: string[] = [];
function makeFirmId() {
  const id = `test_firm_${randomUUID()}`;
  testFirms.push(id);
  return id;
}

afterEach(async () => {
  for (const firmId of testFirms.splice(0)) {
    // cma_sets + cma_set_values + asset_class_correlations cascade on the
    // asset_classes / cma_sets delete. Delete sets first, then classes.
    await db.delete(cmaSets).where(eq(cmaSets.firmId, firmId));
    await db.delete(assetClasses).where(eq(assetClasses.firmId, firmId));
  }
});

async function classIdByName(firmId: string, name: string): Promise<string> {
  const [r] = await db
    .select({ id: assetClasses.id })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.name, name)));
  return r.id;
}

async function projectedSetId(firmId: string): Promise<string> {
  const [r] = await db
    .select({ id: cmaSets.id })
    .from(cmaSets)
    .where(and(eq(cmaSets.firmId, firmId), eq(cmaSets.key, "projected")));
  return r.id;
}

// Read/write a projected cma_set_values geometric_return for one class.
async function projGeoOf(firmId: string, name: string): Promise<string> {
  const setId = await projectedSetId(firmId);
  const acId = await classIdByName(firmId, name);
  const [r] = await db
    .select({ g: cmaSetValues.geometricReturn })
    .from(cmaSetValues)
    .where(and(eq(cmaSetValues.cmaSetId, setId), eq(cmaSetValues.assetClassId, acId)));
  return r.g;
}

async function setProjGeo(firmId: string, name: string, value: string) {
  const setId = await projectedSetId(firmId);
  const acId = await classIdByName(firmId, name);
  await db
    .update(cmaSetValues)
    .set({ geometricReturn: value })
    .where(and(eq(cmaSetValues.cmaSetId, setId), eq(cmaSetValues.assetClassId, acId)));
}

async function acGeoOf(firmId: string, name: string): Promise<string> {
  const [r] = await db
    .select({ g: assetClasses.geometricReturn })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.name, name)));
  return r.g;
}

// Flip the active set: historical seeds active; make projected active instead.
async function makeProjectedActive(firmId: string) {
  await db.update(cmaSets).set({ isActive: false }).where(eq(cmaSets.firmId, firmId));
  await db
    .update(cmaSets)
    .set({ isActive: true })
    .where(and(eq(cmaSets.firmId, firmId), eq(cmaSets.key, "projected")));
}

describe("refreshFirmProjectedValues", () => {
  it("detects a stale projected class and restores the generated value", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId); // projected rows = generated file (current)
    await setProjGeo(firmId, "US Large Cap", "0.1040"); // simulate old clone

    const preview = await buildProjectedValueRefreshPreviewForFirm(firmId);
    const usLarge = preview.classChanges.find((c) => c.name === "US Large Cap")!;
    expect(usLarge).toBeDefined();

    const res = await refreshFirmProjectedValues(firmId, { classIds: [usLarge.id] });
    expect(res.updatedClasses).toBe(1);
    expect(await projGeoOf(firmId, "US Large Cap")).toBe("0.0700");
  });

  it("updates only the selected classes, leaving others stale", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    await setProjGeo(firmId, "US Large Cap", "0.1040");
    await setProjGeo(firmId, "US Mid Cap", "0.1040");

    const preview = await buildProjectedValueRefreshPreviewForFirm(firmId);
    const usLarge = preview.classChanges.find((c) => c.name === "US Large Cap")!;
    await refreshFirmProjectedValues(firmId, { classIds: [usLarge.id] });

    expect(await projGeoOf(firmId, "US Large Cap")).toBe("0.0700");
    expect(await projGeoOf(firmId, "US Mid Cap")).toBe("0.1040");
  });

  it("mirrors asset_classes when projected is the active set", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    await makeProjectedActive(firmId);
    await setProjGeo(firmId, "US Large Cap", "0.1040");

    const preview = await buildProjectedValueRefreshPreviewForFirm(firmId);
    const usLarge = preview.classChanges.find((c) => c.name === "US Large Cap")!;
    await refreshFirmProjectedValues(firmId, { classIds: [usLarge.id] });

    expect(await acGeoOf(firmId, "US Large Cap")).toBe("0.0700"); // mirrored
  });

  it("does NOT touch asset_classes when historical is the active set", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId); // historical active by default
    const before = await acGeoOf(firmId, "US Large Cap");
    await setProjGeo(firmId, "US Large Cap", "0.1040");

    const preview = await buildProjectedValueRefreshPreviewForFirm(firmId);
    const usLarge = preview.classChanges.find((c) => c.name === "US Large Cap")!;
    await refreshFirmProjectedValues(firmId, { classIds: [usLarge.id] });

    expect(await projGeoOf(firmId, "US Large Cap")).toBe("0.0700"); // durable
    expect(await acGeoOf(firmId, "US Large Cap")).toBe(before); // unchanged
  });

  it("rejects a classId with no pending change", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId); // projected already current
    const acId = await classIdByName(firmId, "US Large Cap");
    await expect(
      refreshFirmProjectedValues(firmId, { classIds: [acId] }),
    ).rejects.toBeInstanceOf(ProjectedValueRefreshError);
  });
});
