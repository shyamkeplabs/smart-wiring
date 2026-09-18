# KLS Smart Wiring + DC Simulation v6 — Production Gate

## Frontend

- [x] React + TypeScript canvas preserved as the product UI.
- [x] Smart / 90° / 45° / curved / bus wire modes render different geometries.
- [x] Tinkercad-style wire edit points are interactive.
- [x] Junction mode can split a wire.
- [x] Junction mode can anchor a branch directly to a component terminal.
- [x] Topology-based net highlighting does not rely only on display labels.
- [x] Component values are editable from the inspector.
- [x] Simulation status is visualized on the canvas and inspector.
- [x] Backend errors are surfaced instead of failing silently.
- [x] In-flight simulation requests are cancelled to prevent stale results.
- [x] Save / import / export / undo / redo remain available.

## Backend

- [x] FastAPI service.
- [x] Deterministic bounded DC solver.
- [x] Backend derives electrical nets from pins and edges.
- [x] Ground is an explicit 0 V reference.
- [x] Battery, resistor, switch, LED, motor models are supported.
- [x] Floating terminals and missing ground are rejected.
- [x] Self connections and unsupported terminals are rejected.
- [x] Battery terminal shorts are rejected.
- [x] LED current and motor current limits generate warnings.
- [x] Legacy endpoints preserved for earlier prototypes.

## Automated verification

Current local verification performed in the build environment:

- Python unit/API suite: **9 passed**.
- TypeScript/TSX transpilation syntax check: **PASS**.
- Python bytecode compilation: **PASS**.

A full `npm run build` could not be executed here because this environment could not complete npm package installation from the public registry. Run the final frontend build on the target developer machine/CI after dependency installation.

## Scope guardrail

This is not a general-purpose SPICE simulator. The solver intentionally covers a bounded educational DC model for six electrical types: Battery, Resistor, Switch, LED, Motor, and Ground. Do not claim AC analysis, transient analysis, semiconductor-level simulation, motor back-EMF, or MCU execution for this version.
