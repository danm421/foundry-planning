import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Card, CardBody } from "@/components/card";

interface EmptyBlockProps {
  icon: ReactNode;
  title: string;
  body?: string;
  cta: { href: string; label: string };
}

export default function EmptyBlock({
  icon,
  title,
  body,
  cta,
}: EmptyBlockProps): ReactElement {
  return (
    <Card>
      <CardBody className="flex flex-col items-start gap-3">
        <span className="text-ink-3">{icon}</span>
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-semibold text-ink">{title}</p>
          {body && <p className="text-[13px] text-ink-3">{body}</p>}
        </div>
        <Link
          href={cta.href}
          className="text-[12px] font-medium text-accent hover:text-accent-ink"
        >
          {cta.label}
        </Link>
      </CardBody>
    </Card>
  );
}
