// src/domain/forge/tools/global-actions.ts
//
// GLOBAL (clientless) AGENTIC tools — Plan 2. Firm-scoped via requireOrgId();
// the model never supplies scope. Reads reuse firm-scoped lib queries; writes
// (create_household / set_up_plan) are in
// WRITE_TOOL_NAMES → held by the approval node, run only on the resume pass, and
// emit forge.write_approved themselves on real success (mirroring Tier-B CRM tools).
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { listCrmHouseholds, getCrmHousehold, createCrmHousehold } from "@/lib/crm/households";
import { isUSPSStateCode } from "@/lib/usps-states";
import { createClientForHousehold } from "@/lib/clients/create-client";
import { ensurePlanImport } from "@/lib/imports/plan-builder-core";
import { emitNavigate, emitToolRender } from "../custom-events";
import type { ForgeGlobalToolContext } from "../context";

export function buildGlobalActionTools({ ctx, conversationId }: ForgeGlobalToolContext): StructuredToolInterface[] {
  const findClient = tool(
    async ({ query }: { query: string }) => {
      try {
        const rows = await listCrmHouseholds({ search: query, limit: 10 });
        const matches = rows.map((h) => ({
          name: h.name,
          householdId: h.id,
          clientId: h.planningClient?.id ?? null,
          status: h.status,
        }));
        return JSON.stringify({ matches });
      } catch (e) {
        return e instanceof Error ? e.message : "Failed to search clients.";
      }
    },
    {
      name: "find_client",
      description:
        "Search this advisor's households/clients by name (case-insensitive). Read-only, firm-scoped. " +
        "Returns up to 10 matches with householdId, clientId (null if no plan yet), and status. " +
        "Use to resolve a name the advisor mentions before open_client or tasks_create.",
      schema: z.object({ query: z.string().min(1).describe("a client or household name to search for") }),
    },
  );

  const openClient = tool(
    async ({ householdId }: { householdId: string }) => {
      try {
        const hh = await getCrmHousehold(householdId); // firm-scoped → undefined if not owned
        if (!hh) return "Client not found.";
        const href = hh.planningClient ? `/clients/${hh.planningClient.id}` : `/crm/households/${hh.id}`;
        await emitNavigate(href); // throws if not allowlisted
        return JSON.stringify({ navigated: true, href });
      } catch {
        return "Could not open that client.";
      }
    },
    {
      name: "open_client",
      description:
        "Open an existing client the advisor names (by householdId from find_client — never a raw name). " +
        "Navigates to the client's plan if it has one, otherwise the CRM household page. Firm-scoped, non-destructive.",
      schema: z.object({ householdId: z.string().min(1).describe("a householdId returned by find_client") }),
    },
  );

  const contactSchema = z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    dob: z.string().optional().describe("date of birth, YYYY-MM-DD"),
  });

  const createHousehold = tool(
    async (args: {
      name: string; state: string;
      primaryContact: { firstName: string; lastName: string; dob?: string };
      spouseContact?: { firstName: string; lastName: string; dob?: string };
    }) => {
      try {
        const state = isUSPSStateCode(args.state) ? args.state : undefined;
        const firmId = await requireOrgId(); // re-derive for the audit; createCrmHousehold re-derives too
        const contacts = [
          { role: "primary" as const, firstName: args.primaryContact.firstName,
            lastName: args.primaryContact.lastName, dateOfBirth: args.primaryContact.dob },
          ...(args.spouseContact
            ? [{ role: "spouse" as const, firstName: args.spouseContact.firstName,
                 lastName: args.spouseContact.lastName, dateOfBirth: args.spouseContact.dob }]
            : []),
        ];
        const hh = await createCrmHousehold({
          name: args.name,
          status: "prospect",
          advisorId: ctx.userId, // server-forced; model can never widen the actor
          state,
          contacts,
        });
        await recordAudit({
          action: "forge.write_approved", resourceType: "crm_household", resourceId: hh.id,
          firmId, actorId: ctx.userId, metadata: { tool: "create_household", conversationId },
        });
        await emitNavigate(`/crm/households/${hh.id}`);
        return JSON.stringify({ householdId: hh.id, name: hh.name, suggestion: "set_up_plan" });
      } catch (e) {
        return e instanceof Error ? e.message : "Failed to create the household.";
      }
    },
    {
      name: "create_household",
      description:
        "Create a new CRM household (client record) for this firm. Requires human approval. " +
        "Collect the household name, US state (2-letter), and the primary contact's name (DOB optional); " +
        "a spouse contact is optional. After it's created, offer to set up the financial plan (set_up_plan).",
      schema: z.object({
        name: z.string().min(1).max(200),
        state: z.string().length(2).describe("USPS 2-letter state code, e.g. NJ"),
        primaryContact: contactSchema,
        spouseContact: contactSchema.optional(),
      }),
    },
  );

  const setUpPlan = tool(
    async (args: {
      householdId: string; retirementAge: number; lifeExpectancy: number;
      filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household";
      primaryDob: string; spouseDob?: string;
      spouseRetirementAge?: number; spouseLifeExpectancy?: number;
    }) => {
      try {
        const firmId = await requireOrgId();
        const hh = await getCrmHousehold(args.householdId); // firm-scoped IDOR
        if (!hh) return "Household not found.";
        if (hh.planningClient) return "That household already has a plan — open it instead.";
        const primary = hh.contacts.find((c: { role: string }) => c.role === "primary");
        if (!primary) return "That household has no primary contact — add one before setting up a plan.";
        const spouse = hh.contacts.find((c: { role: string }) => c.role === "spouse");
        const result = await createClientForHousehold({
          household: { id: hh.id, firmId, advisorId: hh.advisorId, state: hh.state },
          primaryContact: { firstName: primary.firstName, lastName: primary.lastName, dateOfBirth: args.primaryDob },
          spouseContact: spouse
            ? { firstName: spouse.firstName, lastName: spouse.lastName, dateOfBirth: args.spouseDob ?? null }
            : null,
          retirementAge: args.retirementAge,
          lifeExpectancy: args.lifeExpectancy,
          filingStatus: args.filingStatus,
          spouseRetirementAge: args.spouseRetirementAge ?? null,
          spouseLifeExpectancy: args.spouseLifeExpectancy ?? null,
        });
        await recordAudit({
          action: "forge.write_approved", resourceType: "client", resourceId: result.clientId,
          firmId, actorId: ctx.userId, metadata: { tool: "set_up_plan", conversationId, householdId: hh.id },
        });
        await emitNavigate(`/clients/${result.clientId}`);
        return JSON.stringify({ clientId: result.clientId });
      } catch (e) {
        return e instanceof Error ? e.message : "Failed to set up the plan.";
      }
    },
    {
      name: "set_up_plan",
      description:
        "Turn an existing household into a full financial plan (projection client). Requires human approval. " +
        "Needs the household id (from find_client/create_household), the primary contact's date of birth, " +
        "retirement age, life expectancy, and filing status (single, married_joint, married_separate, head_of_household). " +
        "Uses the household's stored contact names and state.",
      schema: z.object({
        householdId: z.string().min(1),
        retirementAge: z.number().int().min(30).max(90),
        lifeExpectancy: z.number().int().min(60).max(120),
        filingStatus: z.enum(["single", "married_joint", "married_separate", "head_of_household"]),
        primaryDob: z.string().describe("primary contact's date of birth, YYYY-MM-DD"),
        spouseDob: z.string().optional().describe("spouse's date of birth, YYYY-MM-DD"),
        spouseRetirementAge: z.number().int().min(30).max(90).optional(),
        spouseLifeExpectancy: z.number().int().min(60).max(120).optional(),
      }),
    },
  );

  const buildPlan = tool(
    async (args: {
      householdName: string; state?: string;
      primaryFirstName: string; primaryLastName: string; primaryDob: string;
      spouseFirstName?: string; spouseLastName?: string; spouseDob?: string;
      filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household";
      retirementAge: number; lifeExpectancy: number;
      spouseRetirementAge?: number; spouseLifeExpectancy?: number;
    }) => {
      try {
        const firmId = await requireOrgId();
        const { clientId, importId } = await ensurePlanImport({
          mode: "new", firmId, actorUserId: ctx.userId,
          newHousehold: {
            householdName: args.householdName, state: args.state,
            primary: { firstName: args.primaryFirstName, lastName: args.primaryLastName, dateOfBirth: args.primaryDob },
            spouse: args.spouseFirstName && args.spouseLastName
              ? { firstName: args.spouseFirstName, lastName: args.spouseLastName, dateOfBirth: args.spouseDob }
              : undefined,
            filingStatus: args.filingStatus, retirementAge: args.retirementAge, lifeExpectancy: args.lifeExpectancy,
            spouseRetirementAge: args.spouseRetirementAge,
            spouseLifeExpectancy: args.spouseLifeExpectancy,
          },
        });
        await recordAudit({
          action: "forge.write_approved", resourceType: "client_import", resourceId: importId,
          firmId, actorId: ctx.userId,
          metadata: { tool: "build_plan", conversationId, clientId, mode: "new" },
        });
        await emitToolRender("build_plan", "complete", { clientId, importId, mode: "new" });
        // NO emitNavigate — the advisor stays in Forge to drop files.
        return JSON.stringify({ clientId, importId, mode: "new" });
      } catch (e) {
        return e instanceof Error ? e.message : "Failed to start the plan build.";
      }
    },
    {
      name: "build_plan",
      description:
        "Start building a NEW prospect's financial plan from documents the advisor will upload. Mints the household " +
        "+ base plan, then creates a draft import to attach files to. Collect the household name, US state (2-letter), " +
        "primary contact name + date of birth, filing status (single, married_joint, married_separate, head_of_household), " +
        "retirement age, and life expectancy. A spouse is optional; when there is one, also collect the " +
        "spouse's retirement age and life expectancy — omitting them silently defaults the spouse to 65/95, " +
        "which changes the plan horizon. Requires human approval.",
      schema: z.object({
        householdName: z.string().min(1).max(200),
        state: z.string().length(2).optional().describe("USPS 2-letter state code, e.g. NJ"),
        primaryFirstName: z.string().min(1).max(100),
        primaryLastName: z.string().min(1).max(100),
        primaryDob: z.string().describe("primary contact's date of birth, YYYY-MM-DD"),
        spouseFirstName: z.string().max(100).optional(),
        spouseLastName: z.string().max(100).optional(),
        spouseDob: z.string().optional().describe("spouse's date of birth, YYYY-MM-DD"),
        filingStatus: z.enum(["single", "married_joint", "married_separate", "head_of_household"]),
        retirementAge: z.number().int().min(30).max(90),
        lifeExpectancy: z.number().int().min(60).max(120),
        spouseRetirementAge: z.number().int().min(30).max(90).optional(),
        spouseLifeExpectancy: z.number().int().min(60).max(120).optional(),
      }),
    },
  );

  return [findClient, openClient, createHousehold, setUpPlan, buildPlan];
}
