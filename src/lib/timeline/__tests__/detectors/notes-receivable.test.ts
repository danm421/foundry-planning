import { describe, it, expect } from "vitest";
import { detectNotesReceivableEvents } from "../../detectors/notes-receivable";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectNotesReceivableEvents", () => {
  it("emits origination + maturity cards under 'transaction' for a plain note", () => {
    const data = buildClientData();
    data.notesReceivable = [
      {
        id: "note-1",
        name: "Family loan to Avery",
        faceValue: 100000,
        basis: 100000,
        interestRate: 0.045,
        paymentType: "amortizing",
        monthlyPayment: 1864,
        startYear: 2030,
        startMonth: 1,
        termMonths: 60,
        extraPayments: [],
        owners: [],
      } as any,
    ];
    const projection = runProjection(data);
    const events = detectNotesReceivableEvents(data, projection);
    const orig = events.find((e) => e.id === "transaction:note_origination:note-1");
    const mature = events.find((e) => e.id === "transaction:note_maturity:note-1");
    expect(orig).toBeDefined();
    expect(orig!.year).toBe(2030);
    expect(orig!.category).toBe("transaction");
    expect(orig!.supportingFigure).toMatch(/\$100,000.*4\.5%.*5yr/);
    expect(mature).toBeDefined();
    expect(mature!.year).toBe(2034);
    expect(mature!.category).toBe("transaction");
  });

  it("routes trust-linked notes into the 'estate' category with sale-to-trust title", () => {
    const data = buildClientData();
    data.entities = [
      { id: "ent-idgt", name: "Family IDGT", trustSubType: "idgt", isIrrevocable: true } as any,
    ];
    data.notesReceivable = [
      {
        id: "note-sale",
        name: "Sale to IDGT",
        faceValue: 2_000_000,
        basis: 2_000_000,
        interestRate: 0.035,
        paymentType: "interest_only_balloon",
        startYear: 2030,
        startMonth: 1,
        termMonths: 108,
        linkedTrustEntityId: "ent-idgt",
        extraPayments: [],
        owners: [],
      } as any,
    ];
    const projection = runProjection(data);
    const events = detectNotesReceivableEvents(data, projection);
    const orig = events.find((e) => e.id === "estate:note_origination:note-sale");
    const mature = events.find((e) => e.id === "estate:note_maturity:note-sale");
    expect(orig).toBeDefined();
    expect(orig!.title).toMatch(/Sale to Family IDGT/);
    expect(mature).toBeDefined();
    expect(mature!.year).toBe(2038);
  });

  it("computes maturity year correctly for non-12-divisible terms and non-January starts", () => {
    const data = buildClientData();
    data.notesReceivable = [
      {
        id: "note-30mo",
        name: "30-month note",
        faceValue: 50000,
        basis: 50000,
        interestRate: 0.04,
        paymentType: "amortizing",
        monthlyPayment: 1750,
        startYear: 2030,
        startMonth: 1,
        termMonths: 30,
        extraPayments: [],
        owners: [],
      } as any,
      {
        id: "note-jun36",
        name: "June-start 36-month note",
        faceValue: 75000,
        basis: 75000,
        interestRate: 0.05,
        paymentType: "amortizing",
        monthlyPayment: 2250,
        startYear: 2030,
        startMonth: 6,
        termMonths: 36,
        extraPayments: [],
        owners: [],
      } as any,
    ];
    const projection = runProjection(data);
    const events = detectNotesReceivableEvents(data, projection);
    const m30 = events.find((e) => e.id === "transaction:note_maturity:note-30mo");
    const mJun = events.find((e) => e.id === "transaction:note_maturity:note-jun36");
    expect(m30!.year).toBe(2032);
    expect(mJun!.year).toBe(2033);
  });

  it("emits one card per lump-sum extra payment, skips per_payment extras", () => {
    const data = buildClientData();
    data.notesReceivable = [
      {
        id: "note-extras",
        name: "Loan with extras",
        faceValue: 200000,
        basis: 200000,
        interestRate: 0.04,
        paymentType: "amortizing",
        monthlyPayment: 3680,
        startYear: 2030,
        startMonth: 1,
        termMonths: 60,
        extraPayments: [
          { id: "x-lump-1", noteReceivableId: "note-extras", year: 2032, type: "lump_sum", amount: 25000 },
          { id: "x-per-1", noteReceivableId: "note-extras", year: 2033, type: "per_payment", amount: 200 },
          { id: "x-lump-2", noteReceivableId: "note-extras", year: 2034, type: "lump_sum", amount: 50000 },
        ],
        owners: [],
      } as any,
    ];
    const projection = runProjection(data);
    const events = detectNotesReceivableEvents(data, projection);
    expect(events.find((e) => e.id === "transaction:note_extra:x-lump-1")).toBeDefined();
    expect(events.find((e) => e.id === "transaction:note_extra:x-lump-2")).toBeDefined();
    expect(events.find((e) => e.id === "transaction:note_extra:x-per-1")).toBeUndefined();
  });
});
