import { describe, it, expect } from "vitest";
import {
  distribute,
  buildColumns,
  JOINT_COL,
  COMMUNITY_PROPERTY_COL,
} from "../balance-sheet-shared";
import type { FamilyMember } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";

// Minimal FamilyMember fixtures — cast through unknown like the comparison-section
// tests do; balance-sheet-shared only reads `role`, `id`, and `firstName`.
const client = { id: "c", role: "client", firstName: "Client" } as unknown as FamilyMember;
const spouse = { id: "s", role: "spouse", firstName: "Spouse" } as unknown as FamilyMember;
const familyById = new Map<string, FamilyMember>([
  [client.id, client],
  [spouse.id, spouse],
]);

const ownersJoint: AccountOwner[] = [
  { kind: "family_member", familyMemberId: "c", percent: 0.5 },
  { kind: "family_member", familyMemberId: "s", percent: 0.5 },
];

describe("balance-sheet-shared: distribute by titling", () => {
  it("JTWROS joint lands in JOINT_COL", () => {
    const result = distribute(1_000_000, ownersJoint, familyById, "jtwros");
    expect(result[JOINT_COL]).toBe(1_000_000);
    expect(result[COMMUNITY_PROPERTY_COL]).toBeUndefined();
  });

  it("community_property joint lands in COMMUNITY_PROPERTY_COL", () => {
    const result = distribute(1_000_000, ownersJoint, familyById, "community_property");
    expect(result[COMMUNITY_PROPERTY_COL]).toBe(1_000_000);
    expect(result[JOINT_COL]).toBeUndefined();
  });

  it("defaults to JTWROS when titlingType omitted (back-compat)", () => {
    const result = distribute(500_000, ownersJoint, familyById);
    expect(result[JOINT_COL]).toBe(500_000);
    expect(result[COMMUNITY_PROPERTY_COL]).toBeUndefined();
  });

  it("single-owner accounts ignore titlingType (land in the owner column)", () => {
    const soleOwner: AccountOwner[] = [{ kind: "family_member", familyMemberId: "c", percent: 1 }];
    const result = distribute(250_000, soleOwner, familyById, "community_property");
    expect(result["fm:c"]).toBe(250_000);
    expect(result[JOINT_COL]).toBeUndefined();
    expect(result[COMMUNITY_PROPERTY_COL]).toBeUndefined();
  });
});

describe("balance-sheet-shared: buildColumns column emission", () => {
  it("emits both Joint/ROS and Community Property when both titlings present", () => {
    const dists = [
      distribute(500_000, ownersJoint, familyById, "jtwros"),
      distribute(700_000, ownersJoint, familyById, "community_property"),
    ];
    const cols = buildColumns(dists, [client, spouse], []);
    const labels = cols.map((c) => c.label);
    expect(labels).toContain("Joint/ROS");
    expect(labels).toContain("Community Property");
  });

  it("emits only Joint/ROS when no Community Property accounts exist", () => {
    const dists = [distribute(500_000, ownersJoint, familyById, "jtwros")];
    const cols = buildColumns(dists, [client, spouse], []);
    const labels = cols.map((c) => c.label);
    expect(labels).toContain("Joint/ROS");
    expect(labels).not.toContain("Community Property");
  });

  it("emits only Community Property when no JTWROS joints exist", () => {
    const dists = [distribute(900_000, ownersJoint, familyById, "community_property")];
    const cols = buildColumns(dists, [client, spouse], []);
    const labels = cols.map((c) => c.label);
    expect(labels).toContain("Community Property");
    expect(labels).not.toContain("Joint/ROS");
  });
});
