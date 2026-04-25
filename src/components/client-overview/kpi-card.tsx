import Link from "next/link";
import type { ReactElement } from "react";
import { Card, CardBody } from "@/components/card";
import MoneyText from "@/components/money-text";
import CategoryChip, { type Category } from "./category-chip";
import DeltaPill from "./delta-pill";

interface KpiCardProps {
  href: string;
  num: string;
  categoryLabel: string;
  category: Category;
  label: string;
  value: number | null;
  valueFormat: "currency" | "pct" | "int";
  footnote: string;
  delta?: number | null;
  deltaSuffix?: string;
  loading?: boolean;
}

export default function KpiCard(p: KpiCardProps): ReactElement {
  return (
    <Link href={p.href} className="block">
      <Card className="transition-colors hover:bg-card-hover">
        <CardBody className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <CategoryChip
                num={p.num}
                label={p.categoryLabel}
                category={p.category}
              />
              <p className="text-[12.5px] text-ink-3">{p.label}</p>
            </div>
          </div>
          {p.loading ? (
            <div
              className="h-[28px] w-[88px] rounded-md bg-ink-4/15 animate-pulse"
              aria-hidden
            />
          ) : (
            <MoneyText value={p.value} format={p.valueFormat} size="kpi" />
          )}
          <div className="flex items-center gap-2">
            <DeltaPill delta={p.delta ?? null} suffix={p.deltaSuffix} />
            <p className="text-[11px] text-ink-3">{p.footnote}</p>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
