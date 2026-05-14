import { Document } from "@react-pdf/renderer";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import type { CoverProps } from "@/lib/comparison-pdf/build-cover";
import { paginate } from "@/lib/comparison-pdf/paginate";
import { ensureFontsRegistered } from "@/components/pdf/fonts";
import { ReportPage } from "@/components/pdf/page-wrapper";
import { CoverPage } from "./cover-page";
import { GroupPage } from "./group-page";

ensureFontsRegistered();

export interface ComparisonPdfDocumentProps {
  layout: ComparisonLayoutV5;
  cover: CoverProps;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  branding: BrandingResolved;
  chartImages: Record<string, string>;
  reportYear: number;
}

export function ComparisonPdfDocument(props: ComparisonPdfDocumentProps) {
  const pages = paginate(props.layout, props.cover);
  const totalContent = pages.filter((p) => p.kind !== "cover").length;

  return (
    <Document>
      {pages.map((page, i) => {
        if (page.kind === "cover") {
          return <CoverPage key={`p-${i}`} {...page.props} />;
        }
        const contentIndex = pages.slice(0, i).filter((p) => p.kind !== "cover").length;
        return (
          <ReportPage
            key={`p-${i}`}
            orientation="portrait"
            isCover={false}
            householdName={props.cover.householdName}
            reportTitle={props.layout.title}
            reportYear={props.reportYear}
            firmName={props.branding.firmName}
            logoDataUrl={props.branding.logoDataUrl}
            accentColor={props.branding.primaryColor}
            pageIndex={contentIndex}
            totalPages={totalContent}
          >
            <GroupPage
              groupTitle={
                props.layout.groups.find((g) => g.id === page.groupId)?.title ?? ""
              }
              continued={page.continued}
              cells={page.cells}
              ctx={{
                plans: props.plans,
                mc: props.mc,
                branding: props.branding,
                chartImages: props.chartImages,
              }}
            />
          </ReportPage>
        );
      })}
    </Document>
  );
}
