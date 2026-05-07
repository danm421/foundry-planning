import { describe, it, expect } from "vitest";
import {
  buildMigrationPreview,
  validateMigrationRequest,
  type MigrationPreview,
  type ExistingClass,
} from "../cma-migration";

const std = (name: string, id = name): ExistingClass => ({ id, name });

describe("buildMigrationPreview", () => {
  it("classifies added/removed/unchanged correctly for a fully legacy firm", () => {
    const existing: ExistingClass[] = [
      std("US Large Cap"),
      std("Int'l Developed"),
      std("US Aggregate Bond"),
      std("Cash / Money Market"),
      std("Inflation"),
    ];

    const preview = buildMigrationPreview(existing, [], new Map());

    // unchanged: US Large Cap + Inflation (both standard names)
    expect(preview.assetClasses.unchanged.map((c) => c.name).sort()).toEqual(
      ["Inflation", "US Large Cap"].sort()
    );

    // removed: legacy classes only — Inflation is standard so it isn't removed
    expect(preview.assetClasses.removed.map((c) => c.name).sort()).toEqual(
      ["Cash / Money Market", "Int'l Developed", "US Aggregate Bond"].sort()
    );

    // added: every standard class except US Large Cap + Inflation
    const addedNames = new Set(preview.assetClasses.added.map((c) => c.name));
    expect(addedNames.has("Global ex-US Stock Market")).toBe(true);
    expect(addedNames.has("Short Term Treasury")).toBe(true);
    expect(addedNames.has("US Large Cap")).toBe(false);
    expect(addedNames.has("Inflation")).toBe(false);
  });

  it("includes Inflation in 'added' when the firm doesn't have it", () => {
    const existing: ExistingClass[] = [std("US Large Cap")];
    const preview = buildMigrationPreview(existing, [], new Map());
    expect(preview.assetClasses.added.find((a) => a.name === "Inflation")).toBeDefined();
  });

  it("attaches reference counts and suggested-target to removed classes", () => {
    const existing: ExistingClass[] = [
      std("Cash / Money Market", "cash-id"),
      std("Int'l Developed", "intl-id"),
    ];
    const refs = new Map([
      ["cash-id", { accounts: 3, portfolios: 2 }],
      ["intl-id", { accounts: 0, portfolios: 0 }],
    ]);

    const preview = buildMigrationPreview(existing, [], refs);

    const cash = preview.assetClasses.removed.find(
      (r) => r.name === "Cash / Money Market"
    )!;
    expect(cash).toEqual({
      id: "cash-id",
      name: "Cash / Money Market",
      accountAllocCount: 3,
      portfolioAllocCount: 2,
      suggestedTargetName: "Short Term Treasury",
    });

    const intl = preview.assetClasses.removed.find(
      (r) => r.name === "Int'l Developed"
    )!;
    expect(intl.suggestedTargetName).toBe("Global ex-US Stock Market");
  });

  it("returns null suggestedTargetName for unknown legacy names", () => {
    const existing: ExistingClass[] = [std("My Custom Asset", "x")];
    const preview = buildMigrationPreview(existing, [], new Map());
    expect(preview.assetClasses.removed[0].suggestedTargetName).toBeNull();
  });

  it("excludes Inflation from remap target list", () => {
    const existing: ExistingClass[] = [std("Inflation", "infl-id")];
    const preview = buildMigrationPreview(existing, [], new Map());
    const targetNames = preview.allTargetNames.map((t) => t.name);
    expect(targetNames).not.toContain("Inflation");
    expect(targetNames).toContain("US Large Cap");
  });

  it("flags target names already in the firm vs about-to-be-added", () => {
    const existing: ExistingClass[] = [std("US Large Cap", "lc-id")];
    const preview = buildMigrationPreview(existing, [], new Map());
    const lc = preview.allTargetNames.find((t) => t.name === "US Large Cap")!;
    const tenYr = preview.allTargetNames.find((t) => t.name === "10-year Treasury")!;
    expect(lc.alreadyInFirm).toBe(true);
    expect(tenYr.alreadyInFirm).toBe(false);
  });

  it("counts correlation pairs to add (none missing)", () => {
    const preview = buildMigrationPreview([], [], new Map());
    expect(preview.correlationPairsToAdd).toBe(91);
  });

  it("counts only missing pairs when some are already present", () => {
    const existing: ExistingClass[] = [
      std("US Large Cap", "lc"),
      std("US Mid Cap", "mc"),
    ];
    const correlations = [{ idA: "lc", idB: "mc" }];
    const preview = buildMigrationPreview(existing, correlations, new Map());
    expect(preview.correlationPairsToAdd).toBe(90);
  });
});

describe("validateMigrationRequest", () => {
  const baseRemoved = [
    {
      id: "cash-id",
      name: "Cash / Money Market",
      accountAllocCount: 0,
      portfolioAllocCount: 0,
      suggestedTargetName: "Short Term Treasury",
    },
    {
      id: "agg-id",
      name: "US Aggregate Bond",
      accountAllocCount: 5,
      portfolioAllocCount: 1,
      suggestedTargetName: "10-year Treasury",
    },
  ];
  const preview: MigrationPreview = {
    assetClasses: {
      added: [],
      removed: baseRemoved,
      unchanged: [{ id: "lc-id", name: "US Large Cap" }],
    },
    correlationPairsToAdd: 0,
    allTargetNames: [
      { name: "US Large Cap", alreadyInFirm: true },
      { name: "10-year Treasury", alreadyInFirm: false },
      { name: "Short Term Treasury", alreadyInFirm: false },
    ],
  };

  it("succeeds when every removed class has a valid decision", () => {
    const err = validateMigrationRequest(preview, {
      remappings: {
        "cash-id": { kind: "delete" },
        "agg-id": { kind: "remap", toClassName: "10-year Treasury" },
      },
    });
    expect(err).toBeNull();
  });

  it("fails if a removed class is missing", () => {
    const err = validateMigrationRequest(preview, {
      remappings: { "cash-id": { kind: "delete" } },
    });
    expect(err).toMatch(/Missing remapping for "US Aggregate Bond"/);
  });

  it("fails when delete is requested on an in-use class", () => {
    const err = validateMigrationRequest(preview, {
      remappings: {
        "cash-id": { kind: "delete" },
        "agg-id": { kind: "delete" },
      },
    });
    expect(err).toMatch(/Cannot delete "US Aggregate Bond"/);
  });

  it("fails on invalid remap target name", () => {
    const err = validateMigrationRequest(preview, {
      remappings: {
        "cash-id": { kind: "delete" },
        "agg-id": { kind: "remap", toClassName: "Bogus Class" },
      },
    });
    expect(err).toMatch(/Invalid remap target "Bogus Class"/);
  });

  it("rejects extra remapping keys not in the removed list", () => {
    const err = validateMigrationRequest(preview, {
      remappings: {
        "cash-id": { kind: "delete" },
        "agg-id": { kind: "keep" },
        "stranger-id": { kind: "delete" },
      },
    });
    expect(err).toMatch(/Unexpected remapping/);
  });

  it("allows kind=keep for an in-use class", () => {
    const err = validateMigrationRequest(preview, {
      remappings: {
        "cash-id": { kind: "delete" },
        "agg-id": { kind: "keep" },
      },
    });
    expect(err).toBeNull();
  });
});
