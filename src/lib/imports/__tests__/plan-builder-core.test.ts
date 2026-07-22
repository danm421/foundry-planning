import { describe, it, expect, vi, beforeEach } from "vitest";

// `ensurePlanImport` drives two independent read/write surfaces:
//  - db.select().from().where() for the existing-mode client + base-scenario
//    lookups (queued via mockResolvedValueOnce — client row first, then the
//    base-scenario row)
//  - db.insert().values().returning() for the shared clientImports insert
// Both the household mint (createCrmHousehold) and the client mint
// (createClientForHousehold) are mocked at their chokepoints per AGENTS.md
// ("call them, don't inline client/scenario/family inserts") — this test
// only asserts the *shapes* passed into those chokepoints, not their
// internals (those have their own test suites).
const m = vi.hoisted(() => ({
  where: vi.fn(),
  insertValues: vi.fn(),
  createCrmHousehold: vi.fn(),
  createClientForHousehold: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: (...a: unknown[]) => m.where(...a) }) }),
    insert: () => ({ values: (v: unknown) => ({ returning: () => m.insertValues(v) }) }),
  },
}));
vi.mock("@/lib/crm/households", () => ({
  createCrmHousehold: (...a: unknown[]) => m.createCrmHousehold(...a),
}));
vi.mock("@/lib/clients/create-client", () => ({
  createClientForHousehold: (...a: unknown[]) => m.createClientForHousehold(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => m.recordAudit(...a),
}));

import { ensurePlanImport } from "../plan-builder-core";

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.insertValues.mockResolvedValue([{ id: "imp1" }]);
});

describe("ensurePlanImport", () => {
  describe("mode: existing", () => {
    it("verifies the client, resolves the base scenario, and inserts an updating import", async () => {
      m.where
        .mockResolvedValueOnce([{ id: "c1" }]) // client-in-firm lookup
        .mockResolvedValueOnce([{ id: "base1" }]); // base-scenario lookup

      const result = await ensurePlanImport({
        mode: "existing",
        firmId: "org1",
        actorUserId: "u1",
        existing: { clientId: "c1" },
      });

      expect(result).toEqual({ clientId: "c1", scenarioId: "base1", importId: "imp1" });
      expect(m.createCrmHousehold).not.toHaveBeenCalled();
      expect(m.createClientForHousehold).not.toHaveBeenCalled();

      expect(m.insertValues).toHaveBeenCalledTimes(1);
      const insertArg = m.insertValues.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg).toMatchObject({
        clientId: "c1",
        orgId: "org1",
        scenarioId: "base1",
        mode: "updating",
        status: "draft",
        createdByUserId: "u1",
      });
      expect(insertArg).not.toHaveProperty("origin");

      expect(m.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "import.created",
          resourceType: "client_import",
          resourceId: "imp1",
          clientId: "c1",
          firmId: "org1",
          actorId: "u1",
        }),
      );
    });

    it("throws when the client does not belong to the firm", async () => {
      m.where.mockResolvedValueOnce([]); // no client row for this firm

      await expect(
        ensurePlanImport({
          mode: "existing",
          firmId: "org1",
          actorUserId: "u1",
          existing: { clientId: "nope" },
        }),
      ).rejects.toThrow("Client not found for this firm.");

      expect(m.insertValues).not.toHaveBeenCalled();
    });

    it("throws when the client has no base scenario", async () => {
      m.where
        .mockResolvedValueOnce([{ id: "c1" }]) // client-in-firm lookup succeeds
        .mockResolvedValueOnce([]); // no base scenario

      await expect(
        ensurePlanImport({
          mode: "existing",
          firmId: "org1",
          actorUserId: "u1",
          existing: { clientId: "c1" },
        }),
      ).rejects.toThrow("Client has no base scenario.");

      expect(m.insertValues).not.toHaveBeenCalled();
    });
  });

  describe("mode: new", () => {
    it("mints a household + client, then inserts an onboarding import", async () => {
      m.createCrmHousehold.mockResolvedValue({ id: "hh1", name: "The Smiths" });
      m.createClientForHousehold.mockResolvedValue({ clientId: "c2", scenarioId: "scn2" });

      const result = await ensurePlanImport({
        mode: "new",
        firmId: "org1",
        actorUserId: "u1",
        newHousehold: {
          householdName: "The Smiths",
          state: "NJ",
          primary: { firstName: "Jane", lastName: "Smith", dateOfBirth: "1980-01-01" },
          spouse: { firstName: "John", lastName: "Smith", dateOfBirth: "1981-02-02" },
          filingStatus: "married_joint",
          retirementAge: 65,
          lifeExpectancy: 95,
        },
      });

      expect(result).toEqual({ clientId: "c2", scenarioId: "scn2", importId: "imp1" });

      expect(m.createCrmHousehold).toHaveBeenCalledWith({
        name: "The Smiths",
        status: "prospect",
        advisorId: "u1",
        state: "NJ",
        contacts: [
          { role: "primary", firstName: "Jane", lastName: "Smith", dateOfBirth: "1980-01-01" },
          { role: "spouse", firstName: "John", lastName: "Smith", dateOfBirth: "1981-02-02" },
        ],
      });

      expect(m.createClientForHousehold).toHaveBeenCalledWith({
        household: { id: "hh1", firmId: "org1", advisorId: "u1", state: "NJ" },
        primaryContact: { firstName: "Jane", lastName: "Smith", dateOfBirth: "1980-01-01" },
        spouseContact: { firstName: "John", lastName: "Smith", dateOfBirth: "1981-02-02" },
        retirementAge: 65,
        lifeExpectancy: 95,
        filingStatus: "married_joint",
      });

      expect(m.insertValues).toHaveBeenCalledTimes(1);
      const insertArg = m.insertValues.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg).toMatchObject({
        clientId: "c2",
        orgId: "org1",
        scenarioId: "scn2",
        mode: "onboarding",
        status: "draft",
        createdByUserId: "u1",
      });
      expect(insertArg).not.toHaveProperty("origin");

      expect(m.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "import.created",
          resourceType: "client_import",
          resourceId: "imp1",
          clientId: "c2",
          firmId: "org1",
          actorId: "u1",
        }),
      );
    });

    it("forwards spouse retirement age and life expectancy to client creation", async () => {
      m.createCrmHousehold.mockResolvedValue({ id: "hh3", name: "Okonkwo Household" });
      m.createClientForHousehold.mockResolvedValue({ clientId: "c4", scenarioId: "scn4" });

      await ensurePlanImport({
        mode: "new",
        firmId: "org1",
        actorUserId: "u1",
        newHousehold: {
          householdName: "Okonkwo Household",
          state: "NJ",
          primary: { firstName: "Adaeze", lastName: "Okonkwo", dateOfBirth: "1972-06-14" },
          spouse: { firstName: "Emeka", lastName: "Okonkwo", dateOfBirth: "1970-09-02" },
          filingStatus: "married_joint",
          retirementAge: 65,
          lifeExpectancy: 92,
          spouseRetirementAge: 65,
          spouseLifeExpectancy: 92,
        },
      });

      expect(m.createClientForHousehold).toHaveBeenCalledWith(
        expect.objectContaining({
          retirementAge: 65,
          lifeExpectancy: 92,
          spouseRetirementAge: 65,
          spouseLifeExpectancy: 92,
        }),
      );
    });

    it("leaves the spouse retirement pair undefined when the caller omits it", async () => {
      m.createCrmHousehold.mockResolvedValue({ id: "hh4", name: "Solo Household" });
      m.createClientForHousehold.mockResolvedValue({ clientId: "c5", scenarioId: "scn5" });

      await ensurePlanImport({
        mode: "new",
        firmId: "org1",
        actorUserId: "u1",
        newHousehold: {
          householdName: "Solo Household",
          primary: { firstName: "Ada", lastName: "Solo", dateOfBirth: "1972-06-14" },
          filingStatus: "single",
          retirementAge: 65,
          lifeExpectancy: 92,
        },
      });

      const call = m.createClientForHousehold.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(call.spouseRetirementAge).toBeUndefined();
      expect(call.spouseLifeExpectancy).toBeUndefined();
    });

    it("drops an invalid state and omits spouse when none given", async () => {
      m.createCrmHousehold.mockResolvedValue({ id: "hh2", name: "Solo" });
      m.createClientForHousehold.mockResolvedValue({ clientId: "c3", scenarioId: "scn3" });

      await ensurePlanImport({
        mode: "new",
        firmId: "org1",
        actorUserId: "u1",
        newHousehold: {
          householdName: "Solo",
          state: "ZZ", // not a real USPS code
          primary: { firstName: "Ann", lastName: "Onymous", dateOfBirth: "1970-01-01" },
          filingStatus: "single",
          retirementAge: 67,
          lifeExpectancy: 90,
        },
      });

      expect(m.createCrmHousehold).toHaveBeenCalledWith(
        expect.objectContaining({ state: undefined, contacts: [
          { role: "primary", firstName: "Ann", lastName: "Onymous", dateOfBirth: "1970-01-01" },
        ] }),
      );
      expect(m.createClientForHousehold).toHaveBeenCalledWith(
        expect.objectContaining({
          household: { id: "hh2", firmId: "org1", advisorId: "u1", state: null },
          spouseContact: null,
        }),
      );
    });
  });
});
