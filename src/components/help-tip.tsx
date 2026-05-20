"use client";

interface HelpTipProps {
  text: string;
  className?: string;
}

export function HelpTip({ text, className }: HelpTipProps) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={`inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-gray-600 text-[9px] font-semibold leading-none text-gray-400 hover:border-gray-400 hover:text-gray-200 ${className ?? ""}`}
    >
      ?
    </span>
  );
}