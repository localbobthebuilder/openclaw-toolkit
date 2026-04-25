# Dashboard UI Architecture

This note describes how the dashboard UI should be split and organized when we refactor it.

## Goals

- Keep related UI behavior easy to find.
- Separate rendering from data/normalization logic when it helps readability.
- Prefer meaningful modules over tiny one-function files.
- Reuse shared widgets when the same control or layout appears in multiple places.

## File Types

- `*-view-mixin.ts`
  - Page or feature screens.
  - Owns `html` rendering for a cohesive surface.
- `*-logic-mixin.ts`
  - Data shaping, validation, normalization, lookup, and mutation rules.
  - Should avoid `html` when practical.
- `*-renderer.ts`
  - Reusable render helpers for one feature family or widget family.
- `toolkit-dashboard-ui-helpers.ts`
  - Shared low-level UI primitives used across the dashboard.
- `toolkit-dashboard-render-mixin.ts`
  - Composition only.
  - Wires mixins together and should not own feature logic.

## Splitting Rules

- Extract a render block when it is a real UI concept on its own.
- Keep a small render function inside its parent file if it only serves that screen.
- Merge small one-off render helpers into a nearby feature module instead of creating a lonely file.
- Split logic and rendering when the file becomes hard to scan because both concerns are mixed.
- Prefer one coherent widget module over several tiny files that each hold one method.

## Practical Examples

- Status page: separate view and checklist logic.
- Agent editor: one merged view module for the full editor experience.
- Model selector: one shared modal module because it is reused.
- Markdown editors: one renderer module because the family is shared.

## Default Question

When adding a new file, ask:

1. Is this a screen, a feature, a reusable widget, or logic only?
2. Will this module be reused or does it just help one parent screen?
3. Does extracting it make the code easier to navigate?

If the answer is unclear, keep the code near the parent feature until reuse becomes obvious.
