// src/lib/reports/widgets/index.ts
//
// Side-effect barrel. Importing this module registers every widget kind
// with the widget registry. Import from the builder once at module init —
// `registerWidget` calls run before `makeWidget` is dispatched.
//
// Each subsequent widget task (13/18/19/20/21/22/24/25/26/28/29/30) adds
// a single import line below.

import "./kpi-tile";
import "./cover";
