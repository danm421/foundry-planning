import rawAnnotationPlugin from "chartjs-plugin-annotation";

/**
 * chartjs-plugin-annotation, made safe to register after charts already exist.
 * Register THIS, never the package's default export.
 *
 * Registering a plugin globally makes it join every live chart at that chart's
 * next update, draw or hover. This plugin keeps per-chart state that only its
 * `beforeInit` creates, and Chart.js calls `beforeInit` once, when a chart is
 * constructed — so a chart already on screen when an annotated chart's module
 * loads lazily (an editor chunk opened from the Solver) has no state, and its
 * next update throws "Cannot set properties of undefined (setting
 * 'annotations')".
 *
 * `start` is the hook Chart.js calls whenever a plugin becomes active on a
 * chart: at construction, and on exactly that late join, before any other
 * hook. Building the state there covers both.
 *
 * Passing the plugin per chart instead (`plugins={[...]}`) is not an option:
 * the plugin registers its annotation element types and option defaults only
 * on global registration, and without them it throws on the first annotation
 * it draws.
 */
export const annotationPlugin: typeof rawAnnotationPlugin = {
  ...rawAnnotationPlugin,
  start(chart, args, options) {
    rawAnnotationPlugin.beforeInit?.(chart, args, options);
  },
};
