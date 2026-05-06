// src/components/reports/widget-inspectors/divider.tsx
//
// Inspector body for the divider widget. The widget has no configurable
// props (`DividerProps = Record<string, never>`), so the inspector is a
// zero-state component that renders nothing. The registry's `Inspector`
// field is required, so we still need a component — `() => null` is the
// minimal valid shape.

export function DividerInspector(): null {
  return null;
}
