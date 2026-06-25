// src/components/portal/currency-input.tsx
"use client";
import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { groupNumber } from "@/lib/portal/format";

type CurrencyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  /** Raw numeric string the parent owns — never contains grouping commas. */
  value: string;
  /** Reports the raw typed string back to the parent. */
  onValueChange: (raw: string) => void;
};

/**
 * Text input for dollar amounts. Shows the value comma-grouped while idle
 * ("2,700") and the raw digits while focused, so typing never fights the caret.
 * The parent's `value` stays raw — grouping is display-only — so any existing
 * `Number(value)` parsing keeps working unchanged. Use this for every editable
 * amount field in the portal so they all read like the Spent/Budget columns.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput({ value, onValueChange, onFocus, onBlur, ...rest }, ref) {
    const [focused, setFocused] = useState(false);
    return (
      <input
        ref={ref}
        inputMode="decimal"
        {...rest}
        value={focused ? value : groupNumber(value)}
        onChange={(e) => onValueChange(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
    );
  },
);
