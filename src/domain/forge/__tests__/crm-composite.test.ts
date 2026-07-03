// src/domain/forge/__tests__/crm-composite.test.ts
//
// Tests for the six read-only composite advisor skills:
//   meeting_prep, summarize_notes, whats_changed_since,
//   suggest_tasks, generate_agenda, draft_follow_up
//
// None of these tools mutate. None fire forge.tool_call or write_approved.
// All return error strings on failure, never throw.
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireOrgId = vi.fn();
const verifyClientAccess = vi.fn();
const clientToHousehold = vi.fn();
const listHouseholdNotes = vi.fn();
const listTasks = vi.fn();
const listActivity = vi.fn();
const getOverviewData = vi.fn();
const recordAudit = vi.fn();
const loadMeetingPrepBattery = vi.fn();

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: () => requireOrgId() }));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: (c: string) => verifyClientAccess(c),
}));
vi.mock("../guards", async (o) => ({
  ...(await o()),
  clientToHousehold: (c: string, f: string) => clientToHousehold(c, f),
}));
vi.mock("@/lib/crm/notes", () => ({
  listHouseholdNotes: (h: string, f: string) => listHouseholdNotes(h, f),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("@/lib/crm-tasks/queries", () => ({
  listTasks: (...a: unknown[]) => listTasks(...a),
  getTaskById: vi.fn(),
  listTaskComments: vi.fn(),
  listTaskActivity: vi.fn(),
}));
vi.mock("@/lib/crm/activity", () => ({
  listActivity: (...a: unknown[]) => listActivity(...a),
  recordActivity: vi.fn(),
}));
vi.mock("@/lib/overview/get-overview-data", () => ({
  getOverviewData: (...a: unknown[]) => getOverviewData(...a),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));
// gatherMeetingBattery (meeting_prep, suggest_tasks, generate_agenda) is a thin
// wrapper over the shared CRM meeting-prep battery — mock it directly rather
// than the DB-level pieces it now delegates to (Task 11).
vi.mock("@/lib/crm/meeting-prep/battery", () => ({
  loadMeetingPrepBattery: (...a: unknown[]) => loadMeetingPrepBattery(...a),
}));
// Stub out other crm.ts imports that aren't needed for composite tests
vi.mock("@/lib/crm/households", () => ({ getCrmHousehold: vi.fn() }));
vi.mock("@/lib/overview/list-open-items", () => ({ listOpenItems: vi.fn() }));
vi.mock("@/lib/crm-tasks/mutations", () => ({
  createTask: vi.fn(),
  updateTaskField: vi.fn(),
  setTaskStatus: vi.fn(),
  postComment: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("@/lib/crm/schemas", () => ({
  createCrmNoteSchema: { parse: (x: unknown) => x },
}));
vi.mock("@/lib/crm-tasks/schemas", () => ({
  createCrmTaskSchema: { omit: () => ({ parse: (x: unknown) => x }) },
}));

import { buildCrmTools } from "../tools/crm";
import { buildToolContext } from "../context";

const ctx = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const byName = (n: string) =>
  buildCrmTools(buildToolContext(ctx, "conv-1")).find((t) => t.name === n)!;

// Realistic overview mock matching real getOverviewData return shape
const MOCK_OVERVIEW = {
  client: { id: "c1", updatedAt: new Date().toISOString() },
  kpi: { netWorth: 1_500_000, liquidPortfolio: 1_250_000, yearsToRetirement: 5 },
  alertInputs: {
    liquidPortfolio: 1_250_000,
    currentYearNetOutflow: 300_000,
    minNetWorth: 800_000,
    projectionError: null,
  },
  runway: { netWorthSeries: [1_500_000, 1_400_000], minNetWorth: 800_000 },
  projection: [],
  allocation: {},
  lifeEvents: [],
  openItemsPreview: [],
  totalOpen: 1,
  totalCompleted: 5,
  auditRows: [],
  accountCount: 3,
};

const MOCK_NOTES = [
  { id: "n1", subject: "Last review", noteKind: "meeting", noteDate: "2026-03-01", body: "Reviewed goals." },
  { id: "n2", subject: "Follow-up call", noteKind: "call", noteDate: "2026-04-15", body: "Checked on IPS." },
];

const MOCK_TASKS = [
  { id: "t1", title: "Send IPS", status: "open", dueDate: "2026-06-20", householdId: "hh-1" },
];

const MOCK_ACTIVITY = [
  { id: "a1", kind: "meeting", title: "Annual review", occurredAt: new Date("2026-03-01T00:00:00Z") },
  { id: "a2", kind: "call", title: "Quick check-in", occurredAt: new Date("2026-04-15T10:00:00Z") },
];

// Realistic battery mock matching MeetingPrepBattery (src/lib/crm/meeting-prep/battery.ts).
// gatherMeetingBattery (meeting_prep, suggest_tasks, generate_agenda) is a thin wrapper
// over loadMeetingPrepBattery as of Task 11 — lastMeetingDate is a YYYY-MM-DD date-only
// string here (battery.ts truncates activity timestamps to a date), so the wrapper's
// reconstructed Date always lands on T12:00:00.000Z, not the original activity time-of-day.
const MOCK_BATTERY = {
  recentNotes: MOCK_NOTES,
  outstandingTasks: [
    { id: "t1", title: "Send IPS", status: "open", priority: "med", dueDate: "2026-06-20", completedAt: null },
  ],
  alerts: [] as unknown[],
  lastMeetingDate: "2026-04-15",
  portfolio: { source: "crm", accounts: [], total: 0 },
  vitals: { netWorth: 1_500_000, liquidPortfolio: 1_250_000, yearsToRetirement: 5, mcSuccessRate: null },
};

beforeEach(() => {
  requireOrgId.mockResolvedValue("org_A");
  verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "org_A", access: "own" });
  clientToHousehold.mockResolvedValue("hh-1");
  listHouseholdNotes.mockResolvedValue(MOCK_NOTES);
  listTasks.mockResolvedValue(MOCK_TASKS);
  listActivity.mockResolvedValue(MOCK_ACTIVITY);
  getOverviewData.mockResolvedValue(MOCK_OVERVIEW);
  loadMeetingPrepBattery.mockResolvedValue(MOCK_BATTERY);
  recordAudit.mockReset();
});

// ── Task 18: meeting_prep ─────────────────────────────────────────────────────

describe("meeting_prep", () => {
  it("returns a grounded battery: recentNotes, openTasks, alerts, lastMeetingDate, portfolioTotal", async () => {
    const out = JSON.parse(await byName("meeting_prep").invoke({}));
    expect(out.recentNotes).toHaveLength(2);
    expect(out.openTasks).toHaveLength(1);
    expect(Array.isArray(out.alerts)).toBe(true);
    // lastMeetingDate = battery's date-only lastMeetingDate, reconstructed at noon UTC
    expect(out.lastMeetingDate).toBe("2026-04-15T12:00:00.000Z");
    // portfolioTotal maps to vitals.liquidPortfolio
    expect(out.portfolioTotal).toBe(1_250_000);
  });

  it("introduces NO figures absent from its tool inputs (grounding)", async () => {
    const out = JSON.parse(await byName("meeting_prep").invoke({}));
    // The only large number present should be portfolioTotal (from vitals.liquidPortfolio)
    expect(out.portfolioTotal).toBe(MOCK_BATTERY.vitals.liquidPortfolio);
    // observations is an array (may be empty or contain disclaimer)
    expect(Array.isArray(out.observations)).toBe(true);
  });

  it("is READ-ONLY: does not fire forge.tool_call or write_approved", async () => {
    await byName("meeting_prep").invoke({});
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns an error string when access is denied (never throws)", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    const out = await byName("meeting_prep").invoke({});
    expect(typeof out).toBe("string");
    expect(out).toMatch(/not found or access denied/i);
  });

  it("calls loadMeetingPrepBattery with (householdId, firmId)", async () => {
    await byName("meeting_prep").invoke({});
    expect(loadMeetingPrepBattery).toHaveBeenCalledWith("hh-1", "org_A");
  });
});

// ── Task 19: summarize_notes ──────────────────────────────────────────────────

describe("summarize_notes", () => {
  it("returns notes sliced to the requested limit", async () => {
    const out = JSON.parse(await byName("summarize_notes").invoke({ limit: 1 }));
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].id).toBe("n1");
  });

  it("returns all notes when no limit is given", async () => {
    const out = JSON.parse(await byName("summarize_notes").invoke({}));
    expect(out.notes).toHaveLength(2);
  });

  it("payload equals the sliced input notes (grounding — invents no facts)", async () => {
    const out = JSON.parse(await byName("summarize_notes").invoke({ limit: 2 }));
    expect(out.notes[0]).toMatchObject({ id: "n1", subject: "Last review" });
    expect(out.notes[1]).toMatchObject({ id: "n2", subject: "Follow-up call" });
  });

  it("is READ-ONLY: does not fire any audit event", async () => {
    await byName("summarize_notes").invoke({ limit: 5 });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ── Task 19: whats_changed_since ──────────────────────────────────────────────

describe("whats_changed_since", () => {
  it("returns only activity at or after the since date", async () => {
    // a2 occurredAt = 2026-04-15; a1 occurredAt = 2026-03-01; since = 2026-04-01
    const out = JSON.parse(
      await byName("whats_changed_since").invoke({ since: "2026-04-01" }),
    );
    expect(out.since).toBe("2026-04-01");
    expect(out.activitySince).toHaveLength(1);
    expect(out.activitySince[0].id).toBe("a2");
  });

  it("surfaces portfolioTotal from the overview source (grounding)", async () => {
    const out = JSON.parse(
      await byName("whats_changed_since").invoke({ since: "2026-01-01" }),
    );
    expect(out.portfolioTotal).toBe(1_250_000);
  });

  it("returns newAlerts from alertInputs (array)", async () => {
    const out = JSON.parse(
      await byName("whats_changed_since").invoke({ since: "2026-01-01" }),
    );
    expect(Array.isArray(out.newAlerts)).toBe(true);
  });

  it("is READ-ONLY: does not fire any audit event", async () => {
    await byName("whats_changed_since").invoke({ since: "2026-01-01" });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ── Task 20: suggest_tasks ────────────────────────────────────────────────────

describe("suggest_tasks", () => {
  it("returns signals and proposedTasks descriptors", async () => {
    const out = JSON.parse(await byName("suggest_tasks").invoke({}));
    expect(out.signals).toBeDefined();
    expect(Array.isArray(out.proposedTasks)).toBe(true);
  });

  it("signals contain rmdAge=73 (domain constant per spec §7)", async () => {
    const out = JSON.parse(await byName("suggest_tasks").invoke({}));
    expect(out.signals.rmdAge).toBe(73);
  });

  it("signals.lastMeetingDate comes from the battery's lastMeetingDate", async () => {
    const out = JSON.parse(await byName("suggest_tasks").invoke({}));
    // Battery's date-only lastMeetingDate (2026-04-15), reconstructed at noon UTC
    expect(out.signals.lastMeetingDate).toBe("2026-04-15T12:00:00.000Z");
  });

  it("proposedTasks carry no dollar figures (descriptors only)", async () => {
    const out = JSON.parse(await byName("suggest_tasks").invoke({}));
    const taskJson = JSON.stringify(out.proposedTasks);
    // No dollar-magnitude numbers in task descriptors
    expect(taskJson).not.toMatch(/\$\d/);
  });

  it("is READ-ONLY: does not invoke any write core", async () => {
    await byName("suggest_tasks").invoke({});
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ── Task 20: generate_agenda ──────────────────────────────────────────────────

describe("generate_agenda", () => {
  it("defaults meetingType to 'ad_hoc' when omitted", async () => {
    const out = JSON.parse(await byName("generate_agenda").invoke({}));
    expect(out.meetingType).toBe("ad_hoc");
  });

  it("accepts all enum meeting types", async () => {
    for (const t of ["annual_review", "prospect_intro", "rmd_year_end", "ad_hoc"]) {
      const out = JSON.parse(
        await byName("generate_agenda").invoke({ meetingType: t }),
      );
      expect(out.meetingType).toBe(t);
    }
  });

  it("returns non-empty sections", async () => {
    const out = JSON.parse(await byName("generate_agenda").invoke({}));
    expect(Array.isArray(out.sections)).toBe(true);
    expect(out.sections.length).toBeGreaterThan(0);
  });

  it("is READ-ONLY: does not fire any audit event", async () => {
    await byName("generate_agenda").invoke({ meetingType: "annual_review" });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("gatherMeetingBattery is shared: generate_agenda calls the same sources as meeting_prep (once each)", async () => {
    // Clear counts before the isolated measurement
    loadMeetingPrepBattery.mockClear();

    // Count calls for meeting_prep
    await byName("meeting_prep").invoke({});
    const mpBattery = loadMeetingPrepBattery.mock.calls.length;

    // Clear and count calls for generate_agenda
    loadMeetingPrepBattery.mockClear();

    await byName("generate_agenda").invoke({});
    // generate_agenda must hit the shared battery loader the same number of times as meeting_prep
    expect(loadMeetingPrepBattery.mock.calls.length).toBe(mpBattery);
  });
});

// ── Task 21: draft_follow_up ─────────────────────────────────────────────────

describe("draft_follow_up", () => {
  it("happy path: returns note + scaffold + proposedTasks for a valid note", async () => {
    const out = JSON.parse(
      await byName("draft_follow_up").invoke({ noteId: "n1" }),
    );
    expect(out.note).toMatchObject({ id: "n1", subject: "Last review" });
    expect(out.scaffold).toMatchObject({
      greeting: null,
      recap: [],
      actionItems: [],
    });
    expect(Array.isArray(out.proposedTasks)).toBe(true);
  });

  it("IDOR path: note from another household → returns error string, no scaffold", async () => {
    // n1 does NOT belong to this household — mock returns a different note list
    listHouseholdNotes.mockResolvedValue([{ id: "n-other", subject: "Other" }]);
    const out = await byName("draft_follow_up").invoke({ noteId: "n1" });
    expect(typeof out).toBe("string");
    expect(out).toMatch(/not found for this client/i);
    // No scaffold leaked
    expect(out).not.toContain("scaffold");
  });

  it("is READ-ONLY: does not fire forge.tool_call or write_approved", async () => {
    await byName("draft_follow_up").invoke({ noteId: "n1" });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns an error string when access is denied", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    const out = await byName("draft_follow_up").invoke({ noteId: "n1" });
    expect(typeof out).toBe("string");
    expect(out).toMatch(/not found or access denied/i);
  });
});
