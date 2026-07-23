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
        // Same guard as build_plan, and for the same reason — see the long note
        // there. `create_household` → `set_up_plan` is a first-class alternative
        // to build_plan, and it reaches the identical defect: a spouse on the
        // household means createClientForHousehold stamps its 65/95 defaults,
        // which the Plan basics step then shows unchipped as `build_request`.
        // Keyed on the HOUSEHOLD's spouse contact rather than a request arg,
        // because that is what decides whether the defaults get stamped.
        if (
          spouse &&
          (args.spouseRetirementAge == null || args.spouseLifeExpectancy == null)
        ) {
          return (
            "That household has a spouse, so set_up_plan also needs spouseRetirementAge " +
            "and spouseLifeExpectancy. Ask the advisor for both, then call set_up_plan again."
          );
        }
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
        "Uses the household's stored contact names and state. When the household HAS a spouse contact, " +
        "spouseRetirementAge and spouseLifeExpectancy are BOTH required — ask the advisor for them; the call " +
        "is refused without them rather than defaulting them.",
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
        // A spouse in the request means `createClientForHousehold` will stamp
        // its 65/95 chokepoint defaults onto the clients row — and the import's
        // Plan basics step then reads those columns back and presents the
        // constants as `provenance: "build_request"` with no reason, so no
        // "Assumed" chip: a platform default shown to the advisor as a stated
        // fact, labelled as though it came in as a build_plan argument. Refuse
        // the call instead, so the advisor supplies real numbers.
        //
        // Enforced in the tool body, NOT as a Zod `superRefine` on the schema:
        // build_plan is HITL-gated, and `approvalNode` in graph.ts invokes the
        // confirmed tool through a bare `t.invoke(args, config)` with no
        // try/catch. A schema rejection there throws ToolInputParsingException
        // AFTER the advisor has already clicked Approve, taking the turn down.
        // Returning a message keeps it a normal tool result the model can act
        // on by asking for the two values. (A refinement would also be
        // invisible to the model: zod checks do not serialize into the JSON
        // Schema the tool is bound with — only this description teaches it.)
        const requestHasSpouse = Boolean(args.spouseFirstName && args.spouseLastName);
        if (
          requestHasSpouse &&
          (args.spouseRetirementAge == null || args.spouseLifeExpectancy == null)
        ) {
          return (
            "This household has a spouse, so build_plan also needs spouseRetirementAge " +
            "and spouseLifeExpectancy. Ask the advisor for both, then call build_plan again."
          );
        }
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
        "retirement age, and life expectancy. A spouse is optional, but when the household HAS a spouse, " +
        "spouseRetirementAge and spouseLifeExpectancy are BOTH required — ask the advisor for them; the call " +
        "is refused without them, because guessing them would silently set the plan horizon. " +
        "Requires human approval.",
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

  const ingestFactFinder = tool(
    async (args: {
      mode: "new" | "updating";
      // mode "new":
      householdName?: string;
      state?: string;
      primaryFirstName?: string;
      primaryLastName?: string;
      primaryDob?: string;
      spouseFirstName?: string;
      spouseLastName?: string;
      spouseDob?: string;
      filingStatus?: "single" | "married_joint" | "married_separate" | "head_of_household";
      retirementAge?: number;
      lifeExpectancy?: number;
      spouseRetirementAge?: number;
      spouseLifeExpectancy?: number;
      // mode "updating":
      clientId?: string;
    }) => {
      try {
        const firmId = await requireOrgId();

        if (args.mode === "updating") {
          if (!args.clientId) {
            return "To update an existing plan, pass the clientId of the matched household.";
          }
          const { clientId, importId } = await ensurePlanImport({
            mode: "existing",
            firmId,
            actorUserId: ctx.userId,
            existing: { clientId: args.clientId },
          });
          await recordAudit({
            action: "forge.write_approved",
            resourceType: "client_import",
            resourceId: importId,
            firmId,
            actorId: ctx.userId,
            metadata: { tool: "ingest_fact_finder", conversationId, clientId, mode: "updating" },
          });
          await emitToolRender("ingest_fact_finder", "complete", { clientId, importId, mode: "updating" });
          return JSON.stringify({ clientId, importId, mode: "updating" });
        }

        // mode "new"
        if (!args.householdName || !args.primaryFirstName || !args.primaryLastName || !args.primaryDob) {
          return "To build a new plan I need the household name and the primary contact's first name, last name, and date of birth.";
        }
        const hasSpouse = Boolean(args.spouseFirstName && args.spouseLastName);
        const { clientId, importId } = await ensurePlanImport({
          mode: "new",
          firmId,
          actorUserId: ctx.userId,
          newHousehold: {
            householdName: args.householdName,
            state: args.state,
            primary: {
              firstName: args.primaryFirstName,
              lastName: args.primaryLastName,
              dateOfBirth: args.primaryDob,
            },
            spouse: hasSpouse
              ? { firstName: args.spouseFirstName!, lastName: args.spouseLastName!, dateOfBirth: args.spouseDob }
              : undefined,
            filingStatus: args.filingStatus ?? (hasSpouse ? "married_joint" : "single"),
            // Attach-first defaults: the fact finder often omits horizon numbers.
            // Use documented platform defaults (retire 65 / mortality 95) rather
            // than refusing — the Review Wizard's Plan basics step lets the
            // advisor correct them (unlike the conversational build_plan tool,
            // which refuses so the advisor states them).
            retirementAge: args.retirementAge ?? 65,
            lifeExpectancy: args.lifeExpectancy ?? 95,
            spouseRetirementAge: hasSpouse ? (args.spouseRetirementAge ?? 65) : undefined,
            spouseLifeExpectancy: hasSpouse ? (args.spouseLifeExpectancy ?? 95) : undefined,
          },
        });
        await recordAudit({
          action: "forge.write_approved",
          resourceType: "client_import",
          resourceId: importId,
          firmId,
          actorId: ctx.userId,
          metadata: { tool: "ingest_fact_finder", conversationId, clientId, mode: "new" },
        });
        await emitToolRender("ingest_fact_finder", "complete", { clientId, importId, mode: "new" });
        return JSON.stringify({ clientId, importId, mode: "new" });
      } catch (e) {
        return e instanceof Error ? e.message : "Failed to ingest the fact finder.";
      }
    },
    {
      name: "ingest_fact_finder",
      description:
        "Build or update a plan from a fact finder the advisor ATTACHED (you'll see an " +
        "'[Attached fact finder]' block with the extracted household identity and any duplicate " +
        "matches). Requires human approval. Decide the mode from the identity + duplicate matches + " +
        "the advisor's message:\n" +
        "• No duplicate match → mode 'new': pass householdName, state, primary name + DOB, filing " +
        "status, and spouse fields if present (copy them verbatim from the identity block).\n" +
        "• A duplicate matches AND the advisor said to update/refresh it → mode 'updating' with that " +
        "match's clientId.\n" +
        "• A duplicate matches AND the advisor said to create it anyway/separate → mode 'new'.\n" +
        "• A duplicate matches AND the advisor did NOT say what to do → do NOT call this tool; ask " +
        "them whether to update the existing plan, create a separate household, or cancel, then call " +
        "it with their choice. Retirement age / life expectancy are optional — omit when unknown.",
      schema: z.object({
        mode: z.enum(["new", "updating"]),
        householdName: z.string().min(1).max(200).optional(),
        state: z.string().length(2).optional().describe("USPS 2-letter state code"),
        primaryFirstName: z.string().max(100).optional(),
        primaryLastName: z.string().max(100).optional(),
        primaryDob: z.string().optional().describe("primary DOB, YYYY-MM-DD"),
        spouseFirstName: z.string().max(100).optional(),
        spouseLastName: z.string().max(100).optional(),
        spouseDob: z.string().optional().describe("spouse DOB, YYYY-MM-DD"),
        filingStatus: z.enum(["single", "married_joint", "married_separate", "head_of_household"]).optional(),
        retirementAge: z.number().int().min(30).max(90).optional(),
        lifeExpectancy: z.number().int().min(60).max(120).optional(),
        spouseRetirementAge: z.number().int().min(30).max(90).optional(),
        spouseLifeExpectancy: z.number().int().min(60).max(120).optional(),
        clientId: z.string().optional().describe("mode 'updating': the matched household's clientId"),
      }),
    },
  );

  return [findClient, openClient, createHousehold, setUpPlan, buildPlan, ingestFactFinder];
}
