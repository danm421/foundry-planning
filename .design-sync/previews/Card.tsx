import { Card, CardHeader, CardBody, CardFooter, MoneyText } from "foundry-planning";
import type { ReactNode } from "react";

function Canvas({ children }: { children: ReactNode }) {
  return <div className="bg-paper text-ink font-sans p-6">{children}</div>;
}

export function Basic() {
  return (
    <Canvas>
      <Card className="w-[400px]">
        <CardHeader>
          <h3 className="text-[14px] font-semibold text-ink">Retirement readiness</h3>
          <span className="chip">Base plan</span>
        </CardHeader>
        <CardBody>
          <p className="text-[13px] leading-relaxed text-ink-2">
            The plan funds spending through age 94 with a 12% terminal cushion.
            Social Security starts at 67 for both spouses.
          </p>
        </CardBody>
      </Card>
    </Canvas>
  );
}

export function WithFooter() {
  return (
    <Canvas>
      <Card className="w-[400px]">
        <CardHeader>
          <h3 className="text-[14px] font-semibold text-ink">Linked accounts</h3>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2 text-[13px] text-ink-2">
            <li className="flex items-center justify-between">
              <span>Schwab brokerage</span>
              <MoneyText value={1284500} />
            </li>
            <li className="flex items-center justify-between">
              <span>Vanguard 401(k) — Ellen</span>
              <MoneyText value={912300} />
            </li>
            <li className="flex items-center justify-between">
              <span>529 — Maya</span>
              <MoneyText value={86400} />
            </li>
          </ul>
        </CardBody>
        <CardFooter>
          <span>Updated Jul 11, 2026</span>
          <span className="tabular">14 accounts</span>
        </CardFooter>
      </Card>
    </Canvas>
  );
}

export function Kpi() {
  return (
    <Canvas>
      <Card className="w-[280px]">
        <CardBody>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
            Net worth
          </div>
          <div className="mt-1">
            <MoneyText value={4213850} size="kpi" />
          </div>
          <div className="mt-1 text-[12px] text-good tabular">+$182,400 YTD</div>
        </CardBody>
      </Card>
    </Canvas>
  );
}
