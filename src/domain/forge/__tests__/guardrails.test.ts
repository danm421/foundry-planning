import { describe, it, expect } from "vitest";
import {
  groundingGuardrail,
  accountMaskGuardrail,
  GuardrailTripwire,
} from "../guardrails";

describe("groundingGuardrail", () => {
  it("passes grounded text", () => {
    const r = groundingGuardrail.check({ text: "Your expense is $1,200", toolNumbers: ["1200"] });
    expect(r.pass).toBe(true);
  });
  it("trips on an ungrounded number", () => {
    const r = groundingGuardrail.check({ text: "Your expense is $9,999", toolNumbers: ["1200"] });
    expect(r.pass).toBe(false);
    expect(r.tripwire).toBeInstanceOf(GuardrailTripwire);
  });
});

describe("accountMaskGuardrail", () => {
  it("masks an account number to its last 4 and always passes (transform)", () => {
    const r = accountMaskGuardrail.check({ raw: "1234567890" });
    expect(r.pass).toBe(true);
    expect(r.masked).toMatch(/7890$/);
  });
});
