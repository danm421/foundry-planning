import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

function cx(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { className, children, ...rest },
  ref
) {
  return (
    <section
      ref={ref}
      className={cx("bg-card border border-hair rounded", className)}
      {...rest}
    >
      {children}
    </section>
  );
});

interface CardSubProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardSubProps>(function CardHeader(
  { className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cx(
        "flex items-center justify-between gap-3 px-[var(--pad-card)] py-3 border-b border-hair",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export const CardBody = forwardRef<HTMLDivElement, CardSubProps>(function CardBody(
  { className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cx("px-[var(--pad-card)] py-[var(--pad-card-y)]", className)}
      {...rest}
    >
      {children}
    </div>
  );
});

export const CardFooter = forwardRef<HTMLDivElement, CardSubProps>(function CardFooter(
  { className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cx(
        "flex items-center justify-between gap-3 px-[var(--pad-card)] py-3 text-[12px] text-ink-3 border-t border-hair",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
