import { describe, it, expect } from "vitest";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import type { ClientData } from "@/engine/types";

const source = (relocations: unknown[]): ClientData =>
  ({ relocations } as unknown as ClientData);

describe("relocation-upsert → scenario change drafts", () => {
  it("emits an add when no existing relocation", () => {
    const drafts = mutationsToScenarioChanges(
      source([]),
      "client-1",
      [{ kind: "relocation-upsert", id: "r1", value: { id: "r1", name: "Move to FL", year: 2030, destinationState: "FL" } }],
    );
    expect(drafts).toContainEqual(
      expect.objectContaining({ opType: "add", targetKind: "relocation", targetId: "r1" }),
    );
  });

  it("emits a remove when value is null and the relocation exists", () => {
    const drafts = mutationsToScenarioChanges(
      source([{ id: "r1", name: "Move to FL", year: 2030, destinationState: "FL" }]),
      "client-1",
      [{ kind: "relocation-upsert", id: "r1", value: null }],
    );
    expect(drafts).toContainEqual(
      expect.objectContaining({ opType: "remove", targetKind: "relocation", targetId: "r1" }),
    );
  });

  it("emits an edit diff when a field changed", () => {
    const drafts = mutationsToScenarioChanges(
      source([{ id: "r1", name: "Move to FL", year: 2030, destinationState: "FL" }]),
      "client-1",
      [{ kind: "relocation-upsert", id: "r1", value: { id: "r1", name: "Move to FL", year: 2035, destinationState: "FL" } }],
    );
    expect(drafts).toContainEqual(
      expect.objectContaining({ opType: "edit", targetKind: "relocation", targetId: "r1" }),
    );
  });
});
