import Link from "next/link";
import type { ReactElement } from "react";
import { Card, CardBody, CardHeader } from "@/components/card";
import SectionMarker from "@/components/section-marker";
import { AlertCircleIcon, CheckCircleIcon } from "@/components/icons";
import type { Alert } from "@/lib/alerts";

interface Props {
  alerts: Alert[];
  loading?: boolean;
}

const SEVERITY: Record<Alert["severity"], { border: string; chip: string; icon: string }> = {
  warning: {
    border: "border-l-warn",
    chip: "text-warn bg-warn/12",
    icon: "text-warn",
  },
  critical: {
    border: "border-l-crit",
    chip: "text-crit bg-crit/12",
    icon: "text-crit",
  },
};

export default function AlertsStrip({ alerts, loading }: Props): ReactElement {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-0.5">
            <SectionMarker num="07" label="Alerts" />
            <p className="text-[14px] font-semibold text-ink">Alerts</p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <div className="h-[18px] w-[60%] rounded-md bg-ink-4/15 animate-pulse" aria-hidden />
          <div className="h-[14px] w-[40%] rounded-md bg-ink-4/12 animate-pulse" aria-hidden />
        </CardBody>
      </Card>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-0.5">
            <SectionMarker num="07" label="Alerts · 0 firing" />
            <p className="text-[14px] font-semibold text-ink">Alerts</p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col items-start gap-2">
          <span className="text-good">
            <CheckCircleIcon width={24} height={24} />
          </span>
          <p className="text-[14px] font-semibold text-good">All clear</p>
          <p className="text-[13px] text-ink-3">
            No rules triggered for this household.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <SectionMarker num="07" label={`Alerts · ${alerts.length} firing`} />
          <p className="text-[14px] font-semibold text-ink">Alerts</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col">
        {alerts.map((a, idx) => {
          const s = SEVERITY[a.severity];
          const inner = (
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-ink">{a.title}</p>
                <span
                  className={`rounded-sm px-1.5 py-[2px] font-mono text-xs uppercase ${s.chip}`}
                >
                  {a.severity}
                </span>
              </div>
              <p className="text-[11.5px] text-ink-3">{a.detail}</p>
            </div>
          );
          return (
            <div
              key={a.id}
              className={`flex items-start gap-3 border-l-[3px] py-2.5 pl-3 ${s.border} ${
                idx > 0 ? "mt-2 border-t border-t-hair" : ""
              }`}
            >
              <span className={`mt-0.5 ${s.icon}`}>
                <AlertCircleIcon width={22} height={22} />
              </span>
              {a.href ? (
                <Link href={a.href} className="flex flex-1 items-start gap-3 hover:opacity-90">
                  {inner}
                  <span className="text-[11.5px] text-accent">→</span>
                </Link>
              ) : (
                inner
              )}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
