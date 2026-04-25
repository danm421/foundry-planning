import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { recordAudit } from "@/lib/audit";
import {
  recordCreate,
  recordUpdate,
  recordDelete,
} from "../record-helpers";
import type { FieldLabels } from "../types";

const LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  value: { label: "Account value", format: "currency" },
  owner: { label: "Owner", format: "reference" },
};

beforeEach(() => {
  vi.mocked(recordAudit).mockClear();
});

describe("recordCreate", () => {
  it("writes a create-kind row with the snapshot", async () => {
    await recordCreate({
      action: "account.create",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      snapshot: { name: "Joint Brokerage", value: 50000, owner: null },
    });

    expect(recordAudit).toHaveBeenCalledWith({
      action: "account.create",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      metadata: {
        kind: "create",
        snapshot: { name: "Joint Brokerage", value: 50000, owner: null },
      },
    });
  });
});

describe("recordDelete", () => {
  it("writes a delete-kind row with the snapshot", async () => {
    await recordDelete({
      action: "account.delete",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      snapshot: { name: "Joint Brokerage", value: 50000, owner: null },
    });

    expect(recordAudit).toHaveBeenCalledWith({
      action: "account.delete",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      metadata: {
        kind: "delete",
        snapshot: { name: "Joint Brokerage", value: 50000, owner: null },
      },
    });
  });
});

describe("recordUpdate", () => {
  it("emits one change per differing field", async () => {
    await recordUpdate({
      action: "account.update",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      before: { name: "Old", value: 40000, owner: null },
      after: { name: "Old", value: 50000, owner: null },
      fieldLabels: LABELS,
    });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account.update",
        metadata: {
          kind: "update",
          changes: [
            {
              field: "value",
              label: "Account value",
              from: 40000,
              to: 50000,
              format: "currency",
            },
          ],
        },
      }),
    );
  });

  it("emits multiple changes preserving snapshot field order", async () => {
    await recordUpdate({
      action: "account.update",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      before: { name: "Old", value: 40000, owner: null },
      after: { name: "New", value: 50000, owner: null },
      fieldLabels: LABELS,
    });

    const call = vi.mocked(recordAudit).mock.calls[0]![0];
    expect(call.metadata).toEqual({
      kind: "update",
      changes: [
        { field: "name", label: "Name", from: "Old", to: "New", format: "text" },
        { field: "value", label: "Account value", from: 40000, to: 50000, format: "currency" },
      ],
    });
  });

  it("skips the audit write when no fields changed", async () => {
    await recordUpdate({
      action: "account.update",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      before: { name: "Same", value: 100, owner: null },
      after: { name: "Same", value: 100, owner: null },
      fieldLabels: LABELS,
    });

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("falls back to humanized label when fieldLabels lacks the key", async () => {
    await recordUpdate({
      action: "account.update",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      before: { mystery_field: "a" },
      after: { mystery_field: "b" },
      fieldLabels: {},
    });

    const call = vi.mocked(recordAudit).mock.calls[0]![0];
    expect(call.metadata).toEqual({
      kind: "update",
      changes: [
        { field: "mystery_field", label: "Mystery field", from: "a", to: "b", format: "text" },
      ],
    });
  });

  it("treats reference values as a single field change", async () => {
    await recordUpdate({
      action: "account.update",
      resourceType: "account",
      resourceId: "acc1",
      clientId: "cli1",
      firmId: "firm1",
      before: { owner: { id: "u1", display: "Jane" } },
      after: { owner: { id: "u2", display: "Joe" } },
      fieldLabels: LABELS,
    });

    const call = vi.mocked(recordAudit).mock.calls[0]![0];
    expect(call.metadata).toEqual({
      kind: "update",
      changes: [
        {
          field: "owner",
          label: "Owner",
          from: { id: "u1", display: "Jane" },
          to: { id: "u2", display: "Joe" },
          format: "reference",
        },
      ],
    });
  });
});
