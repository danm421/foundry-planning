// Contract tests for the Goals board's life-expectancy editor: are the payloads
// `life-expectancy-write.ts` builds actually ACCEPTED — and actually APPLIED —
// by the things on the other end of the fetch?
//
// `life-expectancy-write.test.ts` next door asserts the payloads' SHAPE. Every
// assertion there is against this module's own output, so the route rejecting a
// `targetKind`, or the writer silently discarding a field, leaves it fully green
// while every scenario-mode save fails in the browser. This branch found a
// shipped example of exactly that: the Solver emits `targetId: "plan_settings"`
// for this same slot, `scenario_changes.target_id` is a `uuid` column, and there
// are ZERO plan_settings rows in production because every one of those inserts
// threw.
//
// So these import the REAL maps the route and writer consume, and pin the two
// rules that are invisible from inside the builder module.

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { TARGET_KIND_TO_FIELD, SINGLETON_KIND_TO_FIELD } from "@/engine/scenario/applyChanges";
import type { ClientInfo, PlanSettings } from "@/engine/types";
import {
  buildLifeExpectancyClientFields,
  buildLifeExpectancyPlanSettingsFields,
} from "../life-expectancy-write";
import { pruneScenarioFields } from "@/lib/inline-edit/scenario-fields";

const CLIENT_ID = "3f1c2b7e-0000-4000-8000-000000000000";

// Real-shaped effective singletons. Typed as the ENGINE interfaces on purpose:
// tsc then enforces the field names these payloads write, which is half of what
// the `k in baseEntity` assertions below are protecting.
const BASE_CLIENT: ClientInfo = {
  firstName: "Dan",
  lastName: "Cooper",
  dateOfBirth: "1972-03-04",
  retirementAge: 65,
  planEndAge: 92,
  lifeExpectancy: 92,
  spouseName: "Amy",
  spouseDob: "1974-06-01",
  spouseLifeExpectancy: 90,
  filingStatus: "married_joint",
};

const BASE_PLAN_SETTINGS: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.028,
  planStartYear: 2026,
  planEndYear: 2064,
};

// ── The route's targetKind enum ─────────────────────────────────────────────

describe("both singleton kinds are writable through the changes route", () => {
  // `POST /scenarios/[sid]/changes` builds its enum as the UNION of the two
  // maps' keys. Recomputed here the same way, from the same imports: a kind
  // missing from the union is a 400 before the writer is ever reached.
  const WRITABLE_TARGET_KINDS = [
    ...Object.keys(TARGET_KIND_TO_FIELD),
    ...Object.keys(SINGLETON_KIND_TO_FIELD),
  ].filter((v, i, a) => a.indexOf(v) === i);

  it.each(["client", "plan_settings"])("%s is in the route's writable enum", (kind) => {
    expect(WRITABLE_TARGET_KINDS).toContain(kind);
  });

  // DISCRIMINATING, and the reason the union exists. `lookupBaseEntity` checks
  // `SINGLETON_KIND_TO_FIELD` FIRST and returns the singleton; only if that miss
  // does it consult `TARGET_KIND_TO_FIELD`, where both of these map to `null` —
  // and a null mapping THROWS ("nested entities are not writable via this
  // helper"), surfacing as a 500. Reading the singleton map is not a nicety
  // here; it is the only thing standing between this feature and a 500.
  it("resolves through the SINGLETON map — the other map maps both to null", () => {
    expect(SINGLETON_KIND_TO_FIELD.client).toBe("client");
    expect(SINGLETON_KIND_TO_FIELD.plan_settings).toBe("planSettings");

    expect(TARGET_KIND_TO_FIELD.client).toBeNull();
    expect(TARGET_KIND_TO_FIELD.plan_settings).toBeNull();
  });
});

// ── targetId ────────────────────────────────────────────────────────────────

// The route validates `targetId: z.string().uuid()`. That schema is a module
// local (`POST_BODY`) and not exported, so this re-states the rule with the same
// validator primitive rather than importing it — the shipped Solver bug below is
// what makes the rule worth a test at all.
describe("targetId for a singleton edit", () => {
  const targetId = z.string().uuid();

  it("accepts the clientId, which is what both writes send", () => {
    expect(targetId.safeParse(CLIENT_ID).success).toBe(true);
  });

  // `scenario_changes.target_id` is a Postgres `uuid` column and
  // `lookupBaseEntity` ignores the value entirely for singletons, so the
  // clientId is a perfectly good stable key. The Solver's sentinel is not a
  // key at all — `mutations-to-scenario-changes.ts` emits the literal string
  // "plan_settings", the insert throws `invalid input syntax for type uuid`,
  // and "Solver -> change life expectancy -> save to scenario" 500s today.
  // Do not copy that convention here.
  it("rejects the Solver's 'plan_settings' sentinel", () => {
    expect(targetId.safeParse("plan_settings").success).toBe(false);
  });
});

// ── The writer's singleton field filter ─────────────────────────────────────

// `applyEntityEdit` drops any desiredField the base singleton does not carry
// (`Object.entries(desiredFields).filter(([k]) => k in baseEntity)`) — it exists
// because the shared client form posts contact-info fields the engine's
// `ClientInfo` has no place for. Mirrored here so a rename of `planEndAge` or
// `planEndYear` in the engine singletons fails LOUDLY: without these, such a
// rename would make the horizon half of every scenario write vanish into that
// filter, the boards would show the new death year, and the projection would
// keep running to the old one. Exactly the bug this branch set out to fix.
function survivesWriterFilter(
  desiredFields: Record<string, unknown>,
  baseEntity: object,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(desiredFields).filter(([k]) => k in baseEntity));
}

describe("the horizon fields survive applyEntityEdit's singleton filter", () => {
  const clientFields = pruneScenarioFields(BASE_CLIENT);
  const planSettingsFields = pruneScenarioFields(BASE_PLAN_SETTINGS);

  it("planEndAge is a field the base client singleton carries", () => {
    const payload = buildLifeExpectancyClientFields(clientFields, "spouse", 100);
    const kept = survivesWriterFilter(payload, BASE_CLIENT);

    expect(kept).toHaveProperty("planEndAge");
    expect(kept.planEndAge).toBe(102);
    expect(kept.spouseLifeExpectancy).toBe(100);
  });

  it("planEndYear is a field the base plan_settings singleton carries", () => {
    const payload = buildLifeExpectancyPlanSettingsFields(
      planSettingsFields,
      clientFields,
      "spouse",
      100,
    );
    const kept = survivesWriterFilter(payload!, BASE_PLAN_SETTINGS);

    expect(kept).toHaveProperty("planEndYear");
    expect(kept.planEndYear).toBe(2074);
  });

  // The other half of the same filter: the fields we resend to protect the
  // scenario's existing overrides must themselves be overlayable, or the
  // "whole singleton" payload quietly shrinks to something narrower than
  // intended every time it is written.
  it("the resent sibling overrides are overlayable too — nothing is silently pruned", () => {
    const payload = buildLifeExpectancyClientFields(clientFields, "client", 96);
    const kept = survivesWriterFilter(payload, BASE_CLIENT);

    expect(Object.keys(kept).sort()).toEqual(Object.keys(payload).sort());
    expect(kept.retirementAge).toBe(65);
    expect(kept.filingStatus).toBe("married_joint");
  });
});

// ── The wire ────────────────────────────────────────────────────────────────

describe("the payloads survive the JSON round-trip the fetch performs", () => {
  it("loses no key on the way to the route", () => {
    // `spouseRetirementAge: undefined` is what the engine's loaders emit for an
    // absent optional column, and it is the only input that makes this
    // assertion discriminating: without the prune, the payload OBJECT carries
    // the key and the WIRE does not, so the scenario disagrees with itself
    // about which fields it overrides.
    const clientFields = pruneScenarioFields({
      ...BASE_CLIENT,
      spouseRetirementAge: undefined,
    });
    expect(clientFields).not.toHaveProperty("spouseRetirementAge");

    const payload = buildLifeExpectancyClientFields(clientFields, "spouse", 100);
    const overTheWire = JSON.parse(JSON.stringify(payload));

    expect(Object.keys(overTheWire).sort()).toEqual(Object.keys(payload).sort());
    expect(overTheWire.planEndAge).toBe(102);
    expect(overTheWire.spouseLifeExpectancy).toBe(100);
  });
});
