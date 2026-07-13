import { SectionMarker } from "foundry-planning";
import type { CSSProperties, ReactNode } from "react";

function Canvas({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="bg-paper text-ink font-sans p-6" style={style}>
      {children}
    </div>
  );
}

export function Default() {
  return (
    <Canvas>
      <SectionMarker num="01" label="Net worth" />
    </Canvas>
  );
}

export function LongLabel() {
  return (
    <Canvas>
      <SectionMarker num="12" label="Required minimum distributions" />
    </Canvas>
  );
}

export function InReportContext() {
  return (
    <Canvas style={{ width: 420 }}>
      <div>
        <SectionMarker num="04" label="Estate distribution" />
        <h2 className="mt-1 text-lg font-semibold text-ink">Estate Distribution</h2>
        <p className="mt-1 text-[13px] text-ink-2 leading-relaxed">
          At the second death, the estate passes to the Miller Family Trust before
          distributing to the children.
        </p>
      </div>
    </Canvas>
  );
}
