"use client";

import { forwardRef, useState, useEffect, useRef } from "react";
import type { InputHTMLAttributes } from "react";

interface PercentInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange"> {
  value?: number | string;
  defaultValue?: number | string;
  onChange?: (raw: string) => void;
  name?: string;
  /** Max decimal places to keep (default 4). */
  decimals?: number;
}

function cleanInput(input: string, decimals: number): string {
  let cleaned = input.replace(/[^\d.-]/g, "");
  const negative = cleaned.startsWith("-");
  cleaned = cleaned.replace(/-/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) cleaned = parts[0] + "." + parts.slice(1).join("");
  if (parts[1] !== undefined && parts[1].length > decimals) {
    cleaned = parts[0] + "." + parts[1].slice(0, decimals);
  }
  return negative ? `-${cleaned}` : cleaned;
}

export const PercentInput = forwardRef<HTMLInputElement, PercentInputProps>(
  function PercentInput(
    { value, defaultValue, onChange, name, className, placeholder, decimals = 4, ...rest },
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

    useEffect(() => {
      if (!isControlled) setInternal(initial);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initial]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleaned = cleanInput(e.target.value, decimals);
      if (!isControlled) setInternal(cleaned);
      onChange?.(cleaned);
    };

    return (
      <div className="relative">
        <input
          {...rest}
          ref={(node) => {
            displayInputRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
          }}
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={handleChange}
          placeholder={placeholder}
          className={`${className ?? ""} pr-7`}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">
          %
        </span>
        {name && <input type="hidden" name={name} value={raw} />}
      </div>
    );
  }
);
