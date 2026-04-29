// IRS-valid SSN regex:
//   - Area:   001-665, 667-899 (excludes 000, 666, 900-999)
//   - Group:  01-99            (excludes 00)
//   - Serial: 0001-9999        (excludes 0000)
// Separator is optional and may be a hyphen or single space.
const SSN_RE =
    /\b(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g;

export const REDACTED_SSN_PLACEHOLDER = "[REDACTED-SSN]";

export function redactSsns(input: string): { text: string; count: number } {
    let count = 0;
    const text = input.replace(SSN_RE, () => {
        count += 1;
        return REDACTED_SSN_PLACEHOLDER;
    });
    return { text, count };
}
