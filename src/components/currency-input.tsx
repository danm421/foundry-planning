"use client";

import { forwardRef, useState, useEffect, useRef } from "react";
import type { InputHTMLAttributes } from "react";

interface CurrencyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange"> {
  value?: number | string;
  defaultValue?: number | string;
  onChange?: (raw: string) => void;
  name?: string;
}

function formatDisplay(raw: string): string {
  if (raw === "" || raw === "-") return raw;
  const negative = raw.startsWith("-");
  const absRaw = negative ? raw.slice(1) : raw;
  const [intPart, decPart] = absRaw.split(".");
  const digits = intPart.replace(/^0+(?=\d)/, "") || "0";
  const formatted = Number(digits).toLocaleString("en-US");
  const withSign = negative ? `-${formatted}` : formatted;
  return decPart !== undefined ? `${withSign}.${decPart}` : withSign;
}

function cleanInput(input: string): string {
  let cleaned = input.replace(/[^\d.-]/g, "");
  const negative = cleaned.startsWith("-");
  cleaned = cleaned.replace(/-/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) cleaned = parts[0] + "." + parts.slice(1).join("");
  if (parts[1] !== undefined && parts[1].length > 2) {
    cleaned = parts[0] + "." + parts[1].slice(0, 2);
  }
  return negative ? `-${cleaned}` : cleaned;
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    { value, defaultValue, onChange, name, className, placeholder, ...rest },
    ref
  ) {
    const isControlled = value !== undefined;
    const initial =
      defaultValue !== undefined && defaultValue !== null && defaultValue !== ""
        ? String(defaultValue)
        : "";
    const [internal, setInternal] = useState(initial);
    const raw = isControlled ? String(value ?? "") : internal;
    const displayInputRef = useRef<HTMLInputElement | null>(null);

    // Sync internal when switching from uncontrolled defaultValue (e.g., editing prop change)
    useEffect(() => {
      if (!isControlled) setInternal(initial);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initial]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleaned = cleanInput(e.target.value);
      if (!isControlled) setInternal(cleaned);
      onChange?.(cleaned);
    };

    const display = formatDisplay(raw);
    const leftPad = display ? "pl-6" : "pl-3";

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">
          $
        </span>
        <input
          {...rest}
          ref={(node) => {
            displayInputRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
          }}
          type="text"
          inputMode="decimal"
          value={display}
          onChange={handleChange}
          placeholder={placeholder}
          className={`${className ?? ""} ${leftPad}`}
        />
        {name && <input type="hidden" name={name} value={raw} />}
      </div>
    );
  }
);
