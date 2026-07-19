// DB tests for the divorce commit-preview service — buildCommitPreview.
// Hits the real Neon dev branch and skips cleanly without a DB so it never adds
// to the no-delta failing set in CI. Each test owns its world via
// createMarriedFixture and tears it down in `finally` (destroying the client
// cascades divorce_plans → allocations, scenarios, transfers, imports).
import { describe, it, expect } from "vitest";
import {
  getOrCreateDraft,
  upsertAllocations,
  updateDraftSettings,
} from "../divorce-plans";
import { buildCommitPreview } from "../commit-preview";
import { createMarriedFixture, destroyFixture, TEST_ADVISOR_ID } from "./fixtures";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

// Confirm the four needsDecision (joint/no-owner) objects all onto the primary
// side so a preview has no unresolved_joint blocker and no cross-side links.
async function confirmAllToPrimary(f: Awaited<ReturnType<typeof createMarriedFixture>>) {
  await upsertAllocations({
    clientId: f.clientId,
    firmId: f.firmId,
    items: [
      { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "primary", splitPercentToSpouse: null },
      { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
      { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
      { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
    ],
  });
}

d("buildCommitPreview", () => {
  it("fresh draft → unresolved_joint blocker with count 4 (jointBrokerage, house, livingExpense, jointMortgage)", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      const unresolved = preview.blockers.find((b) => b.code === "unresolved_joint");
      expect(unresolved).toBeDefined();
      expect(unresolved!.count).toBe(4);

      // Totals carry the two people's names.
      expect(preview.totals.primary.name).toContain("Taylor");
      expect(preview.totals.spouse.name).toContain("Jordan");
    } finally {
      await destroyFixture(f);
    }
  });

  it("confirming all four joint objects clears every blocker", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      await confirmAllToPrimary(f);

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      expect(preview.blockers).toEqual([]);
    } finally {
      await destroyFixture(f);
    }
  });

  it("a non-base scenario row surfaces a non_base_scenarios blocker", async () => {
    const f = await createMarriedFixture({ withNonBaseScenario: true });
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      const blocker = preview.blockers.find((b) => b.code === "non_base_scenarios");
      expect(blocker).toBeDefined();
      expect(blocker!.count).toBe(1);
    } finally {
      await destroyFixture(f);
    }
  });

  it("an in-flight import surfaces an import_in_flight blocker", async () => {
    const f = await createMarriedFixture({ withActiveImport: true });
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      expect(preview.blockers.some((b) => b.code === "import_in_flight")).toBe(true);
    } finally {
      await destroyFixture(f);
    }
  });

  it("designation naming the primary on the spouse-destined 401(k) → cleanup row (side spouse, remove true by default)", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      // spouse401k already defaults to the spouse; confirm it explicitly.
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [{ targetKind: "account", targetId: f.ids.spouse401k, disposition: "spouse", splitPercentToSpouse: null }],
      });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      const row = preview.cleanup.find(
        (c) => c.source === "beneficiary_designation" && c.id === f.ids.spouseBeneDesignation,
      );
      expect(row).toBeDefined();
      expect(row!.side).toBe("spouse");
      expect(row!.remove).toBe(true);
    } finally {
      await destroyFixture(f);
    }
  });

  it("a persisted remove:false selection wins over the default true", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      await updateDraftSettings({
        clientId: f.clientId,
        firmId: f.firmId,
        patch: {
          beneficiaryCleanup: {
            selections: [
              { source: "beneficiary_designation", id: f.ids.spouseBeneDesignation, remove: false },
            ],
          },
        },
      });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      const row = preview.cleanup.find(
        (c) => c.source === "beneficiary_designation" && c.id === f.ids.spouseBeneDesignation,
      );
      expect(row).toBeDefined();
      expect(row!.remove).toBe(false);
    } finally {
      await destroyFixture(f);
    }
  });

  it("a transfer whose endpoints land on opposite sides → straddle_dropped warning", async () => {
    const f = await createMarriedFixture({ withStraddleTransfer: true });
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      // jointBrokerage → spouse; primaryBrokerage stays primary (default) — the
      // Brokerage Sweep transfer now straddles the two households.
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [{ targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "spouse", splitPercentToSpouse: null }],
      });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      const warning = preview.warnings.find((w) => w.code === "straddle_dropped");
      expect(warning).toBeDefined();
      expect(warning!.label).toBe("Brokerage Sweep");
    } finally {
      await destroyFixture(f);
    }
  });

  // A split account keeps its ORIGINAL id on the primary's book (the spouse
  // share is a new id), so for link endpoints it lands on primary only — a link
  // from it to a spouse-destined endpoint IS a straddle.
  it("a transfer between a split account and a spouse-destined account → straddle_dropped", async () => {
    const f = await createMarriedFixture({ withStraddleTransfer: true });
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      // Brokerage Sweep runs jointBrokerage → primaryBrokerage. Split the source
      // (stays on primary) and send the target to the spouse — now cross-side.
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "split", splitPercentToSpouse: 50 },
          { targetKind: "account", targetId: f.ids.primaryBrokerage, disposition: "spouse", splitPercentToSpouse: null },
        ],
      });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      const warning = preview.warnings.find(
        (w) => w.code === "straddle_dropped" && w.label === "Brokerage Sweep",
      );
      expect(warning).toBeDefined();
    } finally {
      await destroyFixture(f);
    }
  });

  it("a transfer between a split account and a primary-destined account does NOT straddle", async () => {
    const f = await createMarriedFixture({ withStraddleTransfer: true });
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      // Split the source; the target primaryBrokerage stays on the primary
      // (default) — both originals remain on the primary's book, no straddle.
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "account", targetId: f.ids.jointBrokerage, disposition: "split", splitPercentToSpouse: 50 },
        ],
      });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      const warning = preview.warnings.find(
        (w) => w.code === "straddle_dropped" && w.label === "Brokerage Sweep",
      );
      expect(warning).toBeUndefined();
    } finally {
      await destroyFixture(f);
    }
  });

  it("a liability moved across its linked property → link_nulled warning", async () => {
    const f = await createMarriedFixture();
    try {
      await getOrCreateDraft({ clientId: f.clientId, firmId: f.firmId, userId: TEST_ADVISOR_ID });
      // jointMortgage → spouse while its linked house stays primary.
      await upsertAllocations({
        clientId: f.clientId,
        firmId: f.firmId,
        items: [
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "spouse", splitPercentToSpouse: null },
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
        ],
      });

      const preview = await buildCommitPreview({ clientId: f.clientId, firmId: f.firmId });
      const warning = preview.warnings.find((w) => w.code === "link_nulled");
      expect(warning).toBeDefined();
      expect(warning!.label).toBe("Home Mortgage");
    } finally {
      await destroyFixture(f);
    }
  });
});
