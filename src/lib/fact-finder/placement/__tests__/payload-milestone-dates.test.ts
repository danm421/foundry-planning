// src/lib/fact-finder/placement/__tests__/payload-milestone-dates.test.ts
//
// A typed date over one the record ties to a milestone, through payloadFor and
// the real save writers (live dev database): a loan or a note whose start
// Details set "at retirement" takes the fact finder's month and year, and stops
// following the milestone.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { liabilities, notesReceivable } from "@/db/schema";
import { dropSaveFirm, changeLine, inputOf, inSave, seedSaveClient, type SaveSeed } from "../../save/__tests__/harness";
import { LIABILITY_WRITERS } from "../../save/writers/liabilities";
import { NOTE_WRITERS } from "../../save/writers/notes-receivable";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_payload_dates", orgRole: "org:admin" }),
}));

const FIRM = "firm_test_ff_save_payload_dates";
let seed: SaveSeed;
let scope: { clientId: string; firmId: string };

beforeAll(async () => {
  await dropSaveFirm(FIRM);
  seed = await seedSaveClient(FIRM);
  scope = { clientId: seed.clientId, firmId: FIRM };
});
afterAll(() => dropSaveFirm(FIRM));

/** A start Details tied to the client's retirement: the year it falls in, and the tie. */
const AT_RETIREMENT = { startYear: 2033, startMonth: 1, startYearRef: "client_retirement" } as const;

describe("a typed start over one tied to a milestone", () => {
  it("a loan's start: the fact finder's month and year, and no milestone", async () => {
    const [loan] = await db
      .insert(liabilities)
      .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Home mortgage", balance: "300000", interestRate: "0.06", termMonths: 360, ...AT_RETIREMENT })
      .returning({ id: liabilities.id });
    const update = changeLine("liability", { start: "2015-07" }, { recordId: loan.id });
    await inSave(scope, (ctx) => LIABILITY_WRITERS.liability.update(ctx, inputOf(update)));
    const [row] = await db.select().from(liabilities).where(eq(liabilities.id, loan.id));
    expect(row).toMatchObject({ startYear: 2015, startMonth: 7, startYearRef: null });
  });

  it("a note's start: the fact finder's month and year, and no milestone", async () => {
    const [note] = await db
      .insert(notesReceivable)
      .values({
        clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Loan to Emma", faceValue: "20000", basis: "20000", paymentType: "amortizing",
        termMonths: 60, ...AT_RETIREMENT,
      })
      .returning({ id: notesReceivable.id });
    const update = changeLine("note_receivable", { start: "2020-06" }, { recordId: note.id });
    await inSave(scope, (ctx) => NOTE_WRITERS.note_receivable.update(ctx, inputOf(update)));
    const [row] = await db.select().from(notesReceivable).where(eq(notesReceivable.id, note.id));
    expect(row).toMatchObject({ startYear: 2020, startMonth: 6, startYearRef: null });
  });
});
