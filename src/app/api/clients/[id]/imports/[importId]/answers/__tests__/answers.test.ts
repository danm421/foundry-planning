import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AssembleQuestion } from "@/lib/imports/assemble/types";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireActiveSubscription: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/imports/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/authz")>(
    "@/lib/imports/authz",
  );
  return { ...actual, requireImportAccess: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi
    .fn()
    .mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" }),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: { update: vi.fn() } }));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireImportAccess } from "@/lib/imports/authz";
import { recordAudit } from "@/lib/audit";
import { db } from "@/db";

function makeReq(body: unknown = {}) {
  return new Request(
    "https://app.foundryplanning.com/api/clients/c1/imports/i1/answers",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as never;
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

function makeQuestions(): AssembleQuestion[] {
  return [
    {
      id: "q:primary_dob",
      kind: "identity",
      field: "client.primaryDob",
      prompt: "What is the client's date of birth?",
    },
    {
      id: "q:retirement_age",
      kind: "assumption",
      field: "client.retirementAge",
      prompt: "What retirement age should we use?",
    },
  ];
}

let setMock: ReturnType<typeof vi.fn>;
let whereMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);

  whereMock = vi.fn(() => Promise.resolve(undefined));
  setMock = vi.fn(() => ({ where: whereMock }));
  vi.mocked(db.update).mockReturnValue({ set: setMock } as never);
});

describe("answers route", () => {
  it("records an answer, applies primary_dob to the payload, and audits", async () => {
    const questions = makeQuestions();
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      payloadJson: {
        assemble: { version: 1, mergedFileCount: 1, assumptions: [], questions },
        payload: { primary: { firstName: "Jane" } },
      },
    } as never);

    const res = await POST(
      makeReq({ answers: { "q:primary_dob": "1975-04-02" } }),
      params,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, remaining: 1 });

    // The question object was mutated in place with the recorded answer.
    expect(questions[0].answer).toBe("1975-04-02");
    expect(questions[1].answer).toBeUndefined();

    // The persisted payloadJson carries the applied dateOfBirth.
    expect(setMock).toHaveBeenCalledTimes(1);
    const setArg = setMock.mock.calls[0][0] as {
      payloadJson: { payload: { primary: { dateOfBirth?: string; firstName: string } } };
    };
    expect(setArg.payloadJson.payload.primary.dateOfBirth).toBe("1975-04-02");
    expect(setArg.payloadJson.payload.primary.firstName).toBe("Jane");

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "import.assemble.answered",
        resourceId: "i1",
        clientId: "c1",
        firmId: "org_1",
        metadata: { answered: 1, remaining: 1 },
      }),
    );
  });

  it("400s when no assemble state exists yet", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      payloadJson: {},
    } as never);

    const res = await POST(
      makeReq({ answers: { "q:primary_dob": "1975-04-02" } }),
      params,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "No assemble state — run assemble first.",
    });
    expect(setMock).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
