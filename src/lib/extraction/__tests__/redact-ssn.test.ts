import { describe, expect, it } from "vitest";
import { redactSsns } from "../redact-ssn";

describe("redactSsns", () => {
    it("redacts dashed SSN", () => {
        const r = redactSsns("Taxpayer 123-45-6789 here");
        expect(r.text).toBe("Taxpayer [REDACTED-SSN] here");
        expect(r.count).toBe(1);
    });

    it("redacts undashed 9-digit SSN", () => {
        const r = redactSsns("SSN 123456789");
        expect(r.text).toContain("[REDACTED-SSN]");
        expect(r.count).toBe(1);
    });

    it("redacts space-separated SSN", () => {
        const r = redactSsns("SSN 123 45 6789 here");
        expect(r.text).toContain("[REDACTED-SSN]");
        expect(r.count).toBe(1);
    });

    it("does not redact 8-digit account numbers", () => {
        const r = redactSsns("Acct 12345678");
        expect(r.count).toBe(0);
        expect(r.text).toBe("Acct 12345678");
    });

    it("does not redact 10-digit numbers", () => {
        const r = redactSsns("Phone 1234567890");
        expect(r.count).toBe(0);
    });

    it("counts multiple matches", () => {
        const r = redactSsns("A 111-22-3333 B 444-55-6666");
        expect(r.count).toBe(2);
        expect(r.text).toBe("A [REDACTED-SSN] B [REDACTED-SSN]");
    });

    it("does not redact invalid area number 000", () => {
        const r = redactSsns("000-12-3456");
        expect(r.count).toBe(0);
    });

    it("does not redact invalid area number 666", () => {
        const r = redactSsns("666-12-3456");
        expect(r.count).toBe(0);
    });

    it("does not redact area numbers starting with 9", () => {
        const r = redactSsns("923-45-6789");
        expect(r.count).toBe(0);
    });

    it("does not redact group 00", () => {
        const r = redactSsns("123-00-6789");
        expect(r.count).toBe(0);
    });

    it("does not redact serial 0000", () => {
        const r = redactSsns("123-45-0000");
        expect(r.count).toBe(0);
    });

    it("returns input unchanged when no SSN present", () => {
        const r = redactSsns("Hello world, no SSN here.");
        expect(r.count).toBe(0);
        expect(r.text).toBe("Hello world, no SSN here.");
    });

    it("handles empty string", () => {
        const r = redactSsns("");
        expect(r.count).toBe(0);
        expect(r.text).toBe("");
    });
});
