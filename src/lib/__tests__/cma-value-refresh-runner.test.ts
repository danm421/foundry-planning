import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { assetClasses, assetClassCorrelations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { seedCmaForFirm } from "../cma-seed-runner";
import { canonicalPair } from "@/engine/monteCarlo/correlation-matrix";
import {
  refreshFirmStandardValues,
  buildValueRefreshPreviewForFirm,
  ValueRefreshError,
} from "../cma-value-refresh-runner";

const testFirms: string[] = [];
function makeFirmId() {
  const id = `test_firm_${randomUUID()}`;
  testFirms.push(id);
  return id;
}

afterEach(async () => {
  for (const firmId of testFirms.splice(0)) {
    const rows = await db
      .select({ id: assetClasses.id })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    // asset_class_correlations cascade on asset_classes delete (onDelete: cascade).
    if (rows.length > 0) {
      await db.delete(assetClasses).where(eq(assetClasses.firmId, firmId));
    }
  }
});

async function classIdByName(firmId: string, name: string): Promise<string> {
  const [r] = await db
    .select({ id: assetClasses.id })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.name, name)));
  return r.id;
}

async function geoOf(firmId: string, name: string): Promise<string> {
  const [r] = await db
    .select({ g: assetClasses.geometricReturn })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.name, name)));
  return r.g;
}

async function setGeo(firmId: string, name: string, value: string) {
  await db
    .update(assetClasses)
    .set({ geometricReturn: value })
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.name, name)));
}

async function setCorrelation(idA: string, idB: string, value: string) {
  const [a, b] = canonicalPair(idA, idB);
  await db
    .update(assetClassCorrelations)
    .set({ correlation: value })
    .where(
      and(
        eq(assetClassCorrelations.assetClassIdA, a),
        eq(assetClassCorrelations.assetClassIdB, b),
      ),
    );
}

async function getCorrelation(idA: string, idB: string): Promise<string | undefined> {
  const [a, b] = canonicalPair(idA, idB);
  const [row] = await db
    .select({ c: assetClassCorrelations.correlation })
    .from(assetClassCorrelations)
    .where(
      and(
        eq(assetClassCorrelations.assetClassIdA, a),
        eq(assetClassCorrelations.assetClassIdB, b),
      ),
    );
  return row?.c;
}

describe("refreshFirmStandardValues", () => {
  it("updates only the selected stale classes, leaving others stale", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId); // current defaults
    await setGeo(firmId, "US Large Cap", "0.0500"); // make two classes stale
    await setGeo(firmId, "US Mid Cap", "0.0500");

    const preview = await buildValueRefreshPreviewForFirm(firmId);
    const usLarge = preview.classChanges.find((c) => c.name === "US Large Cap")!;
    expect(preview.classChanges.map((c) => c.name).sort()).toEqual(
      ["US Large Cap", "US Mid Cap"].sort(),
    );

    const res = await refreshFirmStandardValues(firmId, {
      classIds: [usLarge.id],
      refreshCorrelations: false,
    });
    expect(res.updatedClasses).toBe(1);

    // US Large Cap restored to default; US Mid Cap still stale.
    expect(await geoOf(firmId, "US Large Cap")).not.toBe("0.0500");
    expect(await geoOf(firmId, "US Mid Cap")).toBe("0.0500");
  });

  it("never touches legacy (non-standard) classes", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    await db.insert(assetClasses).values({
      firmId,
      name: "Crypto",
      geometricReturn: "0.20",
      arithmeticMean: "0.30",
      volatility: "0.60",
      pctOrdinaryIncome: "1",
      pctLtCapitalGains: "0",
      pctQualifiedDividends: "0",
      pctTaxExempt: "0",
      sortOrder: 99,
      assetType: "other",
    });
    await setGeo(firmId, "US Large Cap", "0.0500");

    const preview = await buildValueRefreshPreviewForFirm(firmId);
    expect(preview.classChanges.map((c) => c.name)).not.toContain("Crypto");

    await refreshFirmStandardValues(firmId, {
      classIds: preview.classChanges.map((c) => c.id),
      refreshCorrelations: false,
    });
    expect(await geoOf(firmId, "Crypto")).toBe("0.2000");
  });

  it("refreshes standard correlations and passes the PD guard on a clean firm", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    const a = await classIdByName(firmId, "US Large Cap");
    const b = await classIdByName(firmId, "US Mid Cap");
    await setCorrelation(a, b, "0.00000"); // corrupt one standard pair

    let preview = await buildValueRefreshPreviewForFirm(firmId);
    expect(preview.correlationPairsToRefresh).toBe(1);

    const res = await refreshFirmStandardValues(firmId, {
      classIds: [],
      refreshCorrelations: true,
    });
    expect(res.refreshedCorrelationPairs).toBe(91);

    preview = await buildValueRefreshPreviewForFirm(firmId);
    expect(preview.correlationPairsToRefresh).toBe(0); // back to standard
  });

  it("aborts and rolls back when adopting correlations yields a non-PD matrix", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);

    // Three legacy classes whose mutual correlations form a non-positive-definite
    // 3×3 block ([[1,.99,.99],[.99,1,-.99],[.99,-.99,1]] has negative determinant).
    // They are not standard, so the correlation refresh leaves these pairs intact —
    // the firm's full matrix is non-PD regardless of the standard block.
    const legacy = ["Legacy A", "Legacy B", "Legacy C"];
    for (const name of legacy) {
      await db.insert(assetClasses).values({
        firmId,
        name,
        geometricReturn: "0.05",
        arithmeticMean: "0.06",
        volatility: "0.10",
        pctOrdinaryIncome: "1",
        pctLtCapitalGains: "0",
        pctQualifiedDividends: "0",
        pctTaxExempt: "0",
        sortOrder: 99,
        assetType: "other",
      });
    }
    const [la, lb, lc] = await Promise.all(legacy.map((n) => classIdByName(firmId, n)));
    const insertPair = async (x: string, y: string, v: string) => {
      const [p, q] = canonicalPair(x, y);
      await db
        .insert(assetClassCorrelations)
        .values({ assetClassIdA: p, assetClassIdB: q, correlation: v });
    };
    await insertPair(la, lb, "0.99000");
    await insertPair(la, lc, "0.99000");
    await insertPair(lb, lc, "-0.99000");

    // Also corrupt a standard pair so we can prove the whole tx rolled back.
    const sa = await classIdByName(firmId, "US Large Cap");
    const sb = await classIdByName(firmId, "US Mid Cap");
    await setCorrelation(sa, sb, "0.00000");

    await expect(
      refreshFirmStandardValues(firmId, { classIds: [], refreshCorrelations: true }),
    ).rejects.toBeInstanceOf(ValueRefreshError);

    // Rolled back: the corrupted standard pair is still 0, not the default.
    expect(await getCorrelation(sa, sb)).toBe("0.00000");
  });
});
