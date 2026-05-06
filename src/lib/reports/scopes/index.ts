// src/lib/reports/scopes/index.ts
//
// Side-effect barrel for scope registrations. Importing this module
// triggers each scope's `registerScope` call. Add new scopes here so
// any consumer that imports the barrel picks them up automatically.

import "./cashflow";
// Future scopes (Tasks 22+):
// import "./balance";
// import "./allocation";
// import "./monteCarlo";
