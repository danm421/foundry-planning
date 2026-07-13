// Curated design-system entry for /design-sync — the components Claude Design
// builds with. This app has no packaged component library, so this barrel IS
// the design system's public surface. Keep it in sync with the scoped set in
// .design-sync/config.json (componentSrcMap).

// Primitives
export { Card, CardHeader, CardBody, CardFooter } from "@/components/card";
export { default as MoneyText } from "@/components/money-text";
export { default as SectionMarker } from "@/components/section-marker";
export { HelpTip } from "@/components/help-tip";

// Forms
export { CurrencyInput } from "@/components/currency-input";
export { PercentInput } from "@/components/percent-input";
export { StateSelect } from "@/components/state-select";
export { FieldTooltip } from "@/components/forms/field-tooltip";
export { FieldHintPopover } from "@/components/forms/field-hint-popover";

// Overlays
export { default as DialogShell } from "@/components/dialog-shell";
export { default as DialogTabs } from "@/components/dialog-tabs";
export { default as ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
export { ToastProvider, useToast } from "@/components/toast";

// Chrome
export { default as BrandHeader } from "@/components/brand-header";
export { SidebarProvider } from "@/components/sidebar-provider";
export { ThemeToggle } from "@/components/theme-toggle";
export { default as FooterActions } from "@/components/footer-actions";
export { WizardChrome } from "@/components/wizard-chrome";
export { default as TabAutoSaveIndicator } from "@/components/tab-auto-save-indicator";

// Loading
export {
  Skeleton,
  SkeletonText,
  LoadingLabel,
  SkeletonCard,
  SkeletonKpi,
  SkeletonTable,
  SkeletonChart,
  SkeletonForm,
} from "@/components/skeleton";
